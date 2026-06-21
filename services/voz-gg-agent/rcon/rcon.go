// Package rcon is a dependency-free Source RCON protocol client.
package rcon

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"time"
)

const (
	typeAuth        = 3
	typeAuthResp    = 2
	typeExecCommand = 2
	typeResponse    = 0

	maxPacketSize = 4096 + 16
)

// ErrAuthFailed indicates the server rejected the RCON password.
var ErrAuthFailed = errors.New("rcon: authentication failed")

type packet struct {
	id   int32
	typ  int32
	body string
}

// Client is a connected RCON session. Not safe for concurrent use.
type Client struct {
	conn    net.Conn
	r       *bufio.Reader
	nextID  int32
	timeout time.Duration
}

// Dial connects to addr ("host:port"), authenticates, and returns a Client.
func Dial(addr, password string, timeout time.Duration) (*Client, error) {
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return nil, err
	}
	c := &Client{conn: conn, r: bufio.NewReader(conn), nextID: 1, timeout: timeout}
	if err := c.authenticate(password); err != nil {
		conn.Close()
		return nil, err
	}
	return c, nil
}

// Close releases the underlying connection.
func (c *Client) Close() error { return c.conn.Close() }

func (c *Client) id() int32 {
	id := c.nextID
	c.nextID++
	return id
}

func (c *Client) authenticate(password string) error {
	id := c.id()
	if err := c.write(packet{id: id, typ: typeAuth, body: password}); err != nil {
		return err
	}
	for {
		p, err := c.read()
		if err != nil {
			return err
		}
		// Some servers send a leading empty SERVERDATA_RESPONSE_VALUE; the auth
		// verdict is the first type-2 packet: id == -1 means rejected.
		if p.typ == typeAuthResp {
			if p.id == -1 {
				return ErrAuthFailed
			}
			return nil
		}
	}
}

func (c *Client) write(p packet) error {
	if err := c.conn.SetWriteDeadline(time.Now().Add(c.timeout)); err != nil {
		return err
	}
	payload := append([]byte(p.body), 0, 0) // body null + empty-string null
	size := int32(8 + len(payload))         // id(4) + type(4) + payload
	buf := make([]byte, 0, 4+int(size))
	var hdr [12]byte
	binary.LittleEndian.PutUint32(hdr[0:4], uint32(size))
	binary.LittleEndian.PutUint32(hdr[4:8], uint32(p.id))
	binary.LittleEndian.PutUint32(hdr[8:12], uint32(p.typ))
	buf = append(buf, hdr[:]...)
	buf = append(buf, payload...)
	_, err := c.conn.Write(buf)
	return err
}

func (c *Client) read() (packet, error) {
	if err := c.conn.SetReadDeadline(time.Now().Add(c.timeout)); err != nil {
		return packet{}, err
	}
	var sz [4]byte
	if _, err := io.ReadFull(c.r, sz[:]); err != nil {
		return packet{}, err
	}
	size := int32(binary.LittleEndian.Uint32(sz[:]))
	if size < 10 || size > maxPacketSize {
		return packet{}, fmt.Errorf("rcon: invalid packet size %d", size)
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(c.r, data); err != nil {
		return packet{}, err
	}
	id := int32(binary.LittleEndian.Uint32(data[0:4]))
	typ := int32(binary.LittleEndian.Uint32(data[4:8]))
	body := string(data[8 : len(data)-2])
	return packet{id: id, typ: typ, body: body}, nil
}
