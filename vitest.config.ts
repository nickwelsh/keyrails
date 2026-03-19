import { defineConfig } from "vitest/config";

const shouldWriteJUnit = process.env.VITEST_JUNIT_REPORT === "true";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		exclude: ["node_modules/**", "out/**"],
		reporters: shouldWriteJUnit ? ["default", "junit"] : ["default"],
		outputFile: shouldWriteJUnit ? { junit: "./coverage/test-results.junit.xml" } : undefined,
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov", "cobertura", "json-summary"],
			reportsDirectory: "./coverage",
			exclude: ["src/**/*.test.ts", "src/test-memory.ts"],
		},
		onConsoleLog(log) {
			if (
				log.includes("Skipping license check for TEST_LICENSE_KEY.") ||
				log.includes("REPLICACHE LICENSE NOT VALID") ||
				log.includes("enableAnalytics false")
			) {
				return false;
			}
		},
		browser: {
			enabled: false,
		},
		typecheck: {
			enabled: false,
		},
	},
});
