import type { MetadataRoute } from "next";

// The web app manifest (served at /manifest.webmanifest, open to everybody: it holds no farm data). It makes the website installable on
// a phone's home screen. start_url is /today: the owner lands on Today; a staff phone is sent on to /upload after login.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Yash Poultry Farm",
    short_name: "Farm",
    description: "Register photos and records for Yash Poultry Farm",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    theme_color: "#1d6f42",
    background_color: "#f4f6f8",
    lang: "en-IN",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
