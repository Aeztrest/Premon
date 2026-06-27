/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        // Safety-orange brand scale
        brand: {
          50:  "#F1EEFE",
          100: "#E4DEFD",
          200: "#C9BCFB",
          300: "#AE9BF9",
          400: "#9A84F9",
          500: "#836EF9",
          600: "#6E54F2",
          700: "#5B40D6",
          800: "#4A35AC",
          900: "#200052",
        },
        // Ink (warm black) scale for text + dark surfaces
        ink: {
          50:  "#F7F6F4",
          100: "#EEECE8",
          200: "#DEDAD3",
          300: "#C3BEB5",
          400: "#94908A",
          500: "#6B6862",
          600: "#4A4742",
          700: "#322F2C",
          800: "#211F1D",
          900: "#141414",
        },
        paper: "#FFFFFF",
        bone:  "#FAF8F4",
      },
      boxShadow: {
        card:  "0 1px 2px rgba(20,20,20,0.05), 0 4px 16px -4px rgba(20,20,20,0.06)",
        lift:  "0 2px 4px rgba(20,20,20,0.06), 0 16px 40px -12px rgba(20,20,20,0.14)",
        brand: "0 4px 14px -2px rgba(131, 110, 249,0.35)",
      },
      animation: {
        "spin-slow": "spin 3s linear infinite",
        "pulse-slow": "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
        "shield-in": "shieldIn 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards",
        "fade-up": "fadeUp 0.4s ease forwards",
      },
      keyframes: {
        shieldIn: {
          "0%": { transform: "scale(0.5)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        fadeUp: {
          "0%": { transform: "translateY(12px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
