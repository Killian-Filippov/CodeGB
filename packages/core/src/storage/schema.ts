export const SYMBOL_SCHEMA = `
CREATE NODE TABLE Symbol (
  id STRING,
  label STRING,
  name STRING,
  qualifiedName STRING,
  filePath STRING,
  payload STRING,
  PRIMARY KEY (id)
);`;

export const CODE_RELATION_SCHEMA = `
CREATE REL TABLE CodeRelation (
  FROM Symbol TO Symbol,
  id STRING,
  type STRING,
  confidence DOUBLE,
  reason STRING,
  line INT64
);`;

export const JAVA_SCHEMA_QUERIES = [SYMBOL_SCHEMA, CODE_RELATION_SCHEMA];
