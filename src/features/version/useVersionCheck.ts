import { useState, useEffect } from "react";

const GITHUB_API_URL = "https://api.github.com/repos/M4ss1ck/maibuk/tags";

function compareVersions(current: string, latest: string): boolean {
  const normalize = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [currMajor, currMinor = 0, currPatch = 0] = normalize(current);
  const [latMajor, latMinor = 0, latPatch = 0] = normalize(latest);

  if (latMajor > currMajor) return true;
  if (latMajor === currMajor && latMinor > currMinor) return true;
  if (latMajor === currMajor && latMinor === currMinor && latPatch > currPatch) return true;
  return false;
}

export function useVersionCheck(currentVersion: string) {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    fetch(GITHUB_API_URL)
      .then((res) => res.json())
      .then((tags: { name: string }[]) => {
        if (tags.length > 0) setLatestVersion(tags[0].name);
      })
      .catch(() => {});
  }, []);

  const isOutdated = latestVersion ? compareVersions(currentVersion, latestVersion) : false;

  return { latestVersion, isOutdated };
}
