/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./App.tsx",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        display: ["Cormorant Garamond", "serif"],
      },
      colors: {
        bg: '#050505',
        accent: '#00f2ff',
        success: '#00ffaa',
        danger: '#ff2d55',
        perfect: '#ffea00',
      },
    },
  },
  plugins: [],
}
