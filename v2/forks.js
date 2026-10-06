// ============================================================================
//  Forks — the lines of this app you can switch between from the drawer.
//
//  Each fork is its own GitHub repo with its own Releases, and every fork
//  carries this same list. Which fork a build IS comes from its own publish
//  config (package.json build.publish), so there is no second flag that could
//  disagree with the feed it actually updates from.
//
//  All forks share one appId and one productName on purpose: the other fork's
//  installer then lands in the same folder and keeps the same user data, so a
//  switch keeps settings, sign-ins and notes, and switching back is the same
//  operation in reverse.
// ============================================================================
const pkg = require("./package.json");

const FORKS = [
  {
    id: "main",
    name: "Main",
    owner: "cocacappycola",
    repo: "y70-dashboard",
    about: "The dashboard on its own.",
  },
  {
    id: "jarvis",
    name: "Jarvis",
    owner: "cocacappycola",
    repo: "y70-dashboard-assistant",
    about: "Adds Jarvis, a voice assistant, plus alarms and timers in the top bar.",
  },
];

function publishTarget() {
  const pub = (pkg.build && Array.isArray(pkg.build.publish) && pkg.build.publish[0]) || {};
  return { owner: pub.owner || "", repo: pub.repo || "" };
}

function currentFork() {
  const t = publishTarget();
  return FORKS.find((f) => f.owner === t.owner && f.repo === t.repo) || null;
}

function forkById(id) {
  return FORKS.find((f) => f.id === id) || null;
}

// What the drawer needs: the list, which one this build is, and nothing else.
function describe() {
  const cur = currentFork();
  return {
    current: cur ? cur.id : null,
    forks: FORKS.map((f) => ({ id: f.id, name: f.name, about: f.about })),
  };
}

// The electron-updater feed for a fork.
function feedFor(fork) {
  return { provider: "github", owner: fork.owner, repo: fork.repo, releaseType: "release" };
}

module.exports = { FORKS, currentFork, forkById, describe, feedFor };
