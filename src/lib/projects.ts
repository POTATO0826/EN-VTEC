"use client";

import * as React from "react";
import type { Project } from "@/data/vtec/types";

/**
 * Projects live in this browser until they are published. That is the promise
 * made at the publishing-name stage, so it has to be true here too: nothing in
 * this file leaves the machine.
 */

const KEY = "gpuvtec.projects.v1";

function read(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Project[]) : [];
  } catch {
    return [];
  }
}

function write(projects: Project[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(projects));
    window.dispatchEvent(new Event("gpuvtec:projects"));
  } catch {
    /* storage unavailable - the homepage simply shows its empty state */
  }
}

export function saveProject(project: Project) {
  const existing = read().filter((item) => item.id !== project.id);
  write([project, ...existing]);
}

export function removeProject(id: string) {
  write(read().filter((item) => item.id !== id));
}

/** Reads after mount only, so the server and the first client render agree. */
export function useProjects(): Project[] {
  const [projects, setProjects] = React.useState<Project[]>([]);

  React.useEffect(() => {
    const sync = () => setProjects(read());
    sync();
    window.addEventListener("gpuvtec:projects", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("gpuvtec:projects", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return projects;
}
