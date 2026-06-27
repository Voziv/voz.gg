package main

// updatesCapability mirrors apps/web buildProvisioning's capabilities.updates.
// Operational fields (slug, serverUser, workingDir, rconPort, restartSchedule)
// are NOT here — they are read from the serverControl capability, which updates
// requires.
type updatesCapability struct {
	Enabled bool            `json:"enabled"`
	Policy  string          `json:"policy"`
	Desired *desiredRelease `json:"desired"`
}

type desiredRelease struct {
	ID         string           `json:"id"`
	Kind       string           `json:"kind"` // "apply" | "rollback"
	Version    string           `json:"version"`
	Artifact   *desiredArtifact `json:"artifact"`
	SnapshotID string           `json:"snapshotId"`
}

type desiredArtifact struct {
	URL      string `json:"url"`
	HashAlgo string `json:"hashAlgo"`
	Hash     string `json:"hash"`
	Size     int64  `json:"size"`
}
