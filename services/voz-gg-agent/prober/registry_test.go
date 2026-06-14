package prober

import "testing"

func TestForMapsGameTypes(t *testing.T) {
	if _, ok := For("minecraft-java").(SLP); !ok {
		t.Fatal("minecraft-java should map to SLP")
	}
	if _, ok := For("source").(A2S); !ok {
		t.Fatal("source should map to A2S")
	}
	for _, g := range []string{"generic-tcp", "unknown", "minecraft-bedrock", "anything-else"} {
		if _, ok := For(g).(TCP); !ok {
			t.Fatalf("%s should fall back to TCP", g)
		}
	}
}

func TestEffectiveQueryPort(t *testing.T) {
	// source default query port is the game port when queryPort is 0.
	if got := EffectiveQueryPort("source", 27015, 0); got != 27015 {
		t.Fatalf("source default query port = %d, want 27015", got)
	}
	// explicit queryPort wins.
	if got := EffectiveQueryPort("source", 27015, 27016); got != 27016 {
		t.Fatalf("explicit query port = %d, want 27016", got)
	}
	// non-source falls back to the game port.
	if got := EffectiveQueryPort("minecraft-java", 25565, 0); got != 25565 {
		t.Fatalf("default query port = %d, want 25565", got)
	}
}
