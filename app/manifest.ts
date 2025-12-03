export default function manifest() {
  return {
    name: "SynerLink",
    short_name: "SynerLink",
    description: "SynerLink",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0d6efd",
    icons: [
      {
        src: "/iconocel.png",
        type: "image/png",
        sizes: "192x192",
      },
      {
        src: "/iconocel.png",
        type: "image/png",
        sizes: "512x512",
      }
    ]
  };
}
