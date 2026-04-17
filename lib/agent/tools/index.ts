/**
 * Registers all available tools. Import this module to populate the registry.
 */

import "./pappers-search";
import "./societe-com-lookup";
import "./google-maps-search";
import "./google-search";
import "./pages-jaunes-search";
import "./facebook-lookup";
import "./linkedin-search";
import "./fb-ad-library";
import "./website-finder";
import "./website-audit";
import "./dirigeant-research";
import "./contact-page-scraper";
import "./scratchpad";
import "./save-lead";
import "./ask-user";

// Agent v3 generic tools (always registered)
import "./todo";
import "./plan";
import "./reflection";
import "./memory";
import "./approval";
import "./web_fetch";
import "./web_search";
import "./agentic-browse";
import "./gmail";
import "./calendar";

// Self-improvement & self-extension
import "./learn";
import "./tool-creator";

export { getAllToolNames, getToolDefinitions, executeTool } from "../tool-registry";
