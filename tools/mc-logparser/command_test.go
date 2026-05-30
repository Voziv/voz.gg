package main

import "testing"

func TestResolveCommand(t *testing.T) {
	cases := map[string]struct {
		args    []string
		want    string
		wantErr bool
	}{
		"backfill": {args: []string{"backfill"}, want: "backfill"},
		"watch":    {args: []string{"watch"}, want: "watch"},
		"none":     {args: []string{}, wantErr: true},
		"unknown":  {args: []string{"frobnicate"}, wantErr: true},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := resolveCommand(c.args)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected error, got command %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}
