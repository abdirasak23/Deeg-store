import type { NextConfig } from "next";
const config: NextConfig = {
	poweredByHeader: false,
	outputFileTracingRoot: process.cwd(),
	distDir: process.env.NEXT_BUILD_DIST_DIR || ".next",
};
export default config;
