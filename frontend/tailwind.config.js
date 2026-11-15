/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FBF8EF",
        surface: "#FFFEF9",
        sunken: "#F4EFE0",
        line: { DEFAULT: "#E8E1CE", strong: "#D6CCB0" },
        ink: { DEFAULT: "#262A3B", soft: "#4A4F63", muted: "#7B8092", faint: "#A6A9B6" },
        accent: { DEFAULT: "#5A8A72", dark: "#46705B", soft: "#E3EEE6" },
        gold: { DEFAULT: "#B7893A", soft: "#F6EBD0" },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["Plus Jakarta Sans", "Inter", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(60,50,20,0.04), 0 8px 30px rgba(60,50,20,0.07)",
        lift: "0 2px 4px rgba(60,50,20,0.05), 0 18px 44px rgba(60,50,20,0.12)",
      },
    },
  },
  plugins: [],
};
