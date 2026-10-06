import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NavBreadcrumbs } from "./nav-breadcrumbs";

afterEach(cleanup);

describe("NavBreadcrumbs", () => {
  it.each([
    ["/projects", ["Chantiers", "Projets"]],
    ["/projects/forecasts", ["Chantiers", "Prévisions EAC"]],
    ["/field/logs/JT-0042", ["Chantiers", "Chantier", "Logs", "JT-0042"]],
  ])("déduit le fil d’Ariane pour %s", (pathname, labels) => {
    render(<NavBreadcrumbs pathname={pathname} />);

    const nav = screen.getByRole("navigation", { name: "Fil d’Ariane" });
    expect(Array.from(nav.querySelectorAll("li")).map((node) => node.textContent)).toEqual(labels);
    expect(nav.querySelector("[aria-current='page']")?.textContent).toBe(labels.at(-1));
  });
});
