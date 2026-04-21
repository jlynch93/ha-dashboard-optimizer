// Shared types used across routes and the client.

export interface OllamaInstance {
  url: string;
  models: string[];
  label: string;
}

export interface HaEntity {
  entity_id: string;
  friendly_name: string;
  state: string;
  domain: string;
  area?: string;
  device_class?: string;
  unit?: string;
}

export interface HaDomainGroup {
  domain: string;
  count: number;
  /** Sampled entities (may be truncated). See `truncated`. */
  entities: HaEntity[];
  /** True if `entities` does not contain every entity in this domain. */
  truncated: boolean;
}

export interface HaSummary {
  location: string;
  entity_count: number;
  domains: HaDomainGroup[];
  areas: string[];
  /** Per-domain cap used when sampling `entities`. */
  sample_limit: number;
}

export interface YamlValidation {
  valid: boolean;
  error?: string;
  /** Number of top-level views detected (0 if invalid or missing). */
  view_count: number;
  /** Number of cards across all views (0 if invalid or missing). */
  card_count: number;
}

export interface ExtractedYaml {
  optimizedYaml: string;
  explanation: string;
  validation: YamlValidation;
}
