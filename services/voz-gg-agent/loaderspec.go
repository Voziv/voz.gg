package main

import (
	"fmt"
	"regexp"
	"strings"
)

func jvmOrDefault(jvmArgs string) string {
	if strings.TrimSpace(jvmArgs) == "" {
		return "-Xmx2G"
	}
	return jvmArgs
}

// deriveLaunch builds the ExecStart body for a loader server. CWD is the server
// working dir; bridge symlinks (created at install/adopt time) make the loader's
// relative library paths resolve into current/ while world/mods stay in the
// working dir.
func deriveLaunch(loader, loaderVersion, mc, jvmArgs string) string {
	j := jvmOrDefault(jvmArgs)
	switch loader {
	case "neoforge":
		return fmt.Sprintf("java %s @current/libraries/net/neoforged/neoforge/%s/unix_args.txt nogui", j, loaderVersion)
	case "forge":
		return fmt.Sprintf("java %s @current/libraries/net/minecraftforge/forge/%s-%s/unix_args.txt nogui", j, mc, loaderVersion)
	case "fabric":
		return fmt.Sprintf("java %s -jar current/fabric-server-launch.jar nogui", j)
	}
	return ""
}

// bridgesFor lists working-dir entries that must symlink into current/ so the
// loader's relative paths resolve while shared state stays in the working dir.
func bridgesFor(loader string) []string {
	switch loader {
	case "neoforge", "forge":
		return []string{"libraries"}
	case "fabric":
		return []string{"libraries", "server.jar", "fabric-server-launcher.properties"}
	}
	return nil
}

// installArgs builds the installer argv (run with CWD = staging dir).
func installArgs(loader, installerPath, mc, loaderVersion, stagingDir string) []string {
	switch loader {
	case "neoforge", "forge":
		return []string{"-jar", installerPath, "--installServer"}
	case "fabric":
		return []string{"-jar", installerPath, "server", "-mcversion", mc, "-loader", loaderVersion, "-dir", stagingDir, "-downloadMinecraft"}
	}
	return nil
}

// markersFor lists files whose presence proves the staged install succeeded.
func markersFor(loader, mc, loaderVersion string) []string {
	switch loader {
	case "neoforge":
		return []string{fmt.Sprintf("libraries/net/neoforged/neoforge/%s/unix_args.txt", loaderVersion)}
	case "forge":
		return []string{fmt.Sprintf("libraries/net/minecraftforge/forge/%s-%s/unix_args.txt", mc, loaderVersion)}
	case "fabric":
		return []string{"fabric-server-launch.jar"}
	}
	return nil
}

// loaderArtifactNames lists top-level entries that belong to the versioned
// release dir (moved during adoption); world/mods/config/snapshots stay in
// the working dir.
func loaderArtifactNames(loader string) []string {
	switch loader {
	case "neoforge", "forge":
		return []string{"libraries", "run.sh", "run.bat", "user_jvm_args.txt"}
	case "fabric":
		return []string{"libraries", "server.jar", "fabric-server-launch.jar", "fabric-server-launcher.properties"}
	}
	return nil
}

// deriveNeoforgeMcVersionGo converts a NeoForge version (major.minor.build) to
// its Minecraft version (1.major.minor), collapsing a zero minor to 1.major.
func deriveNeoforgeMcVersionGo(neoforgeVersion string) string {
	parts := strings.SplitN(neoforgeVersion, ".", 3)
	if len(parts) < 2 {
		return "1." + neoforgeVersion
	}
	if parts[1] == "0" {
		return "1." + parts[0]
	}
	return "1." + parts[0] + "." + parts[1]
}

var neoforgePathRe = regexp.MustCompile(`libraries/net/neoforged/neoforge/([^/]+)/unix_args\.txt`)
var forgePathRe = regexp.MustCompile(`libraries/net/minecraftforge/forge/([^/]+)/unix_args\.txt`)
var fabricLaunchRe = regexp.MustCompile(`fabric-server-launch\.jar`)

// identifyFlatInstall recovers the installed version from a flat install's file
// listing, per the Worker-declared loader. Fabric has no version in its launch
// jar name; callers cross-check fabric against the desired loaderVersion instead.
func identifyFlatInstall(loader string, listing []string) (string, error) {
	for _, p := range listing {
		switch loader {
		case "neoforge":
			if m := neoforgePathRe.FindStringSubmatch(p); m != nil {
				return m[1], nil
			}
		case "forge":
			if m := forgePathRe.FindStringSubmatch(p); m != nil {
				return m[1], nil
			}
		case "fabric":
			if fabricLaunchRe.MatchString(p) {
				return "", fmt.Errorf("fabric version not in install; cross-check desired")
			}
		}
	}
	return "", fmt.Errorf("could not identify %s version from install", loader)
}
