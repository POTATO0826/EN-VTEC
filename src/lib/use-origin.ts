"use client";

import * as React from "react";

/**
 * This site's address, for the commands the local agent runs against it.
 * Without it the agent defaults to http://127.0.0.1:3000, so a command copied
 * from the deployed site would talk to a local server that never saw this
 * session. Read after mount, so the server and client render the same HTML.
 */
export function useOrigin() {
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}
