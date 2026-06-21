package rcon

import (
	"encoding/binary"
	"errors"
	"io"
	"net"
	"testing"
	"time"
)

// fakeServer speaks just enough Source RCON for tests. password is the accepted
// secret. For EXECCOMMAND (type 2) with a non-empty body it replies with the
// fragments configured in respond; an empty-body EXECCOMMAND is treated as the
// caller's terminator and echoed back as a single empty type-0 packet.
type fakeServer struct {
	ln       net.Listener
	password string
	respond  func(cmd string) []string // fragments for a command
}

func newFakeServer(t *testing.T, password string, respond func(string) []string) *fakeServer {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	fs := &fakeServer{ln: ln, password: password, respond: respond}
	go fs.serve()
	t.Cleanup(func() { ln.Close() })
	return fs
}

func (fs *fakeServer) addr() string { return fs.ln.Addr().String() }

func (fs *fakeServer) serve() {
	for {
		conn, err := fs.ln.Accept()
		if err != nil {
			return
		}
		go fs.handle(conn)
	}
}

func readPacket(r io.Reader) (id, typ int32, body string, err error) {
	var sz [4]byte
	if _, err = io.ReadFull(r, sz[:]); err != nil {
		return
	}
	size := int32(binary.LittleEndian.Uint32(sz[:]))
	data := make([]byte, size)
	if _, err = io.ReadFull(r, data); err != nil {
		return
	}
	id = int32(binary.LittleEndian.Uint32(data[0:4]))
	typ = int32(binary.LittleEndian.Uint32(data[4:8]))
	body = string(data[8 : len(data)-2])
	return
}

func writePacket(w io.Writer, id, typ int32, body string) error {
	payload := append([]byte(body), 0, 0)
	size := int32(8 + len(payload))
	buf := make([]byte, 0, 4+size)
	var hdr [12]byte
	binary.LittleEndian.PutUint32(hdr[0:4], uint32(size))
	binary.LittleEndian.PutUint32(hdr[4:8], uint32(id))
	binary.LittleEndian.PutUint32(hdr[8:12], uint32(typ))
	buf = append(buf, hdr[:]...)
	buf = append(buf, payload...)
	_, err := w.Write(buf)
	return err
}

func (fs *fakeServer) handle(conn net.Conn) {
	defer conn.Close()
	for {
		id, typ, body, err := readPacket(conn)
		if err != nil {
			return
		}
		switch typ {
		case 3: // AUTH
			if body == fs.password {
				_ = writePacket(conn, id, 2, "")
			} else {
				_ = writePacket(conn, -1, 2, "")
			}
		case 2: // EXECCOMMAND
			if body == "" { // terminator
				_ = writePacket(conn, id, 0, "")
				continue
			}
			for _, frag := range fs.respond(body) {
				_ = writePacket(conn, id, 0, frag)
			}
		}
	}
}

func TestDialAuthSuccess(t *testing.T) {
	fs := newFakeServer(t, "secret", func(string) []string { return []string{"ok"} })
	c, err := Dial(fs.addr(), "secret", 2*time.Second)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	c.Close()
}

func TestDialAuthFailure(t *testing.T) {
	fs := newFakeServer(t, "secret", func(string) []string { return nil })
	_, err := Dial(fs.addr(), "wrong", 2*time.Second)
	if !errors.Is(err, ErrAuthFailed) {
		t.Fatalf("err = %v, want ErrAuthFailed", err)
	}
}
