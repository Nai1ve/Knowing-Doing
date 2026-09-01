CREATE INDEX IF NOT EXISTS idx_writing_cluster_members_cluster_order
  ON writing_cluster_members(cluster_id, display_order, id);
CREATE INDEX IF NOT EXISTS idx_writing_cluster_members_cluster_role_order
  ON writing_cluster_members(cluster_id, role, display_order, id);
CREATE INDEX IF NOT EXISTS idx_writing_curation_jobs_project_created
  ON writing_curation_jobs(project_id, created_at DESC);
