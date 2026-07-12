package main

import "testing"

func TestDeriveLaunchNeoforge(t *testing.T) {
	got := deriveLaunch("neoforge", "21.1.234", "1.21.1", "-Xmx4G")
	want := "java -Xmx4G @current/libraries/net/neoforged/neoforge/21.1.234/unix_args.txt nogui"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestDeriveLaunchForge(t *testing.T) {
	got := deriveLaunch("forge", "52.1.14", "1.21.1", "")
	want := "java -Xmx2G @current/libraries/net/minecraftforge/forge/1.21.1-52.1.14/unix_args.txt nogui"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestDeriveLaunchFabric(t *testing.T) {
	got := deriveLaunch("fabric", "0.16.9", "1.21.1", "-Xmx4G")
	want := "java -Xmx4G -jar current/fabric-server-launch.jar nogui"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestIdentifyFlatInstallNeoforge(t *testing.T) {
	listing := []string{"run.sh", "libraries/net/neoforged/neoforge/21.1.200/unix_args.txt", "user_jvm_args.txt"}
	v, err := identifyFlatInstall("neoforge", listing)
	if err != nil || v != "21.1.200" {
		t.Fatalf("got %q err %v", v, err)
	}
}

func TestIdentifyFlatInstallForge(t *testing.T) {
	listing := []string{"libraries/net/minecraftforge/forge/1.21.1-52.1.0/unix_args.txt"}
	v, err := identifyFlatInstall("forge", listing)
	if err != nil || v != "1.21.1-52.1.0" {
		t.Fatalf("got %q err %v", v, err)
	}
}

func TestIdentifyFlatInstallUnparseable(t *testing.T) {
	if _, err := identifyFlatInstall("neoforge", []string{"server.jar"}); err == nil {
		t.Fatal("expected error for unparseable install")
	}
}

func TestDeriveNeoforgeMcVersionGo(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"21.1.234", "1.21.1"},
		{"21.0.5", "1.21"},
		{"20.4.80", "1.20.4"},
	}
	for _, c := range cases {
		if got := deriveNeoforgeMcVersionGo(c.in); got != c.want {
			t.Fatalf("deriveNeoforgeMcVersionGo(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestDeriveNeoforgeMcVersionGoDualScheme(t *testing.T) {
	cases := map[string]string{
		"20.2.59":       "1.20.2",
		"21.1.234":      "1.21.1",
		"21.0.5":        "1.21",
		"26.1.0.5-beta": "26.1",
		"26.2.0.7-beta": "26.2",
		"26.1.3.10":     "26.1.3",
		"27.0.0.1":      "27.0",
	}
	for in, want := range cases {
		if got := deriveNeoforgeMcVersionGo(in); got != want {
			t.Errorf("deriveNeoforgeMcVersionGo(%q) = %q, want %q", in, got, want)
		}
	}
}
