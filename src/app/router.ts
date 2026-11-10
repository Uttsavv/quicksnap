import { signal } from "@preact/signals";

export type Route = { name: "studio" } | { name: "library" } | { name: "design" } | { name: "editor"; id: string };

function parse(hash: string): Route {
    const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "library") return { name: "library" };
    if (parts[0] === "design") return { name: "design" };
    if (parts[0] === "editor" && parts[1]) return { name: "editor", id: decodeURIComponent(parts[1]) };
    return { name: "studio" };
}

export const route = signal<Route>(parse(location.hash));
addEventListener("hashchange", () => (route.value = parse(location.hash)));

export function href(r: Route): string {
    if (r.name === "library") return "#/library";
    if (r.name === "design") return "#/design";
    if (r.name === "editor") return `#/editor/${encodeURIComponent(r.id)}`;
    return "#/";
}

export function navigate(r: Route) {
    location.hash = href(r);
}
