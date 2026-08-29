"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ATLASSIAN_BROWSE_BASE_URL = exports.UNTAGGED_LABEL = void 0;
exports.atlassianIssueUrl = atlassianIssueUrl;
exports.UNTAGGED_LABEL = '__untagged__';
/** Official Atlassian browse URL. Do not derive this from JIRA_DOMAIN (API/proxy hosts). */
exports.ATLASSIAN_BROWSE_BASE_URL = 'https://phonepe.atlassian.net/browse';
function atlassianIssueUrl(issueKey) {
    return `${exports.ATLASSIAN_BROWSE_BASE_URL}/${issueKey}`;
}
