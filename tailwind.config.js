/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        room: "0 20px 70px rgba(31, 32, 56, 0.08)"
      }
    }
  },
  plugins: []
};
