CREATE TABLE IF NOT EXISTS jira_projects (
  id VARCHAR(64) NOT NULL,
  project_key VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  project_type_key VARCHAR(64) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_jira_projects_key (project_key),
  KEY idx_jira_projects_updated_at (updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS jira_issues (
  id VARCHAR(64) NOT NULL,
  issue_key VARCHAR(64) NOT NULL,
  project_key VARCHAR(32) NOT NULL,
  summary TEXT NOT NULL,
  status VARCHAR(128) NOT NULL,
  issue_type VARCHAR(128) NULL,
  priority VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  resolved_at DATETIME(3) NULL,
  raw_json JSON NULL,
  synced_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_jira_issues_key (issue_key),
  KEY idx_jira_issues_project_updated (project_key, updated_at),
  KEY idx_jira_issues_status (status),
  KEY idx_jira_issues_sprint (project_key, updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS jira_sync_state (
  source_name VARCHAR(64) NOT NULL,
  last_synced_at DATETIME(3) NULL,
  last_success_at DATETIME(3) NULL,
  last_error TEXT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (source_name)
) ENGINE=InnoDB;
