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

CREATE TABLE IF NOT EXISTS jira_sprints (
  id INT NOT NULL,
  board_id INT NULL,
  name VARCHAR(255) NOT NULL,
  state VARCHAR(32) NOT NULL,
  start_date DATETIME(3) NULL,
  end_date DATETIME(3) NULL,
  complete_date DATETIME(3) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_jira_sprints_state (state)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS jira_issue_types (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS jira_statuses (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  category_key VARCHAR(64) NULL,
  category_name VARCHAR(128) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS jira_issues (
  id VARCHAR(64) NOT NULL,
  issue_key VARCHAR(64) NOT NULL,
  project_key VARCHAR(32) NOT NULL,
  summary TEXT NOT NULL,
  status VARCHAR(128) NOT NULL,
  status_category VARCHAR(64) NULL,
  issue_type VARCHAR(128) NULL,
  priority VARCHAR(128) NULL,
  assignee VARCHAR(255) NULL,
  story_points DECIMAL(10,2) NULL,
  flagged TINYINT(1) NOT NULL DEFAULT 0,
  labels_json JSON NULL,
  components_json JSON NULL,
  license_bu_json JSON NULL,
  audit_type_json JSON NULL,
  application_json JSON NULL,
  epic_key VARCHAR(64) NULL,
  epic_name VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  resolved_at DATETIME(3) NULL,
  in_progress_at DATETIME(3) NULL,
  last_status_changed_at DATETIME(3) NULL,
  raw_json JSON NULL,
  synced_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_jira_issues_key (issue_key),
  KEY idx_jira_issues_project_updated (project_key, updated_at),
  KEY idx_jira_issues_status (status),
  KEY idx_jira_issues_assignee (assignee)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS jira_issue_sprints (
  issue_id VARCHAR(64) NOT NULL,
  sprint_id INT NOT NULL,
  PRIMARY KEY (issue_id, sprint_id),
  KEY idx_jira_issue_sprints_sprint (sprint_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS jira_sync_state (
  source_name VARCHAR(64) NOT NULL,
  last_synced_at DATETIME(3) NULL,
  last_success_at DATETIME(3) NULL,
  last_issue_updated_at DATETIME(3) NULL,
  last_error TEXT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (source_name)
) ENGINE=InnoDB;
