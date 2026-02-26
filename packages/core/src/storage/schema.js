export const CLASS_SCHEMA = `
CREATE NODE TABLE Class (
  id STRING,
  name STRING,
  qualifiedName STRING,
  packageName STRING,
  filePath STRING,
  startLine INT64,
  endLine INT64,
  modifiers STRING[],
  superClass STRING,
  interfaces STRING[],
  annotations STRING[],
  PRIMARY KEY (id)
);`;
export const METHOD_SCHEMA = `
CREATE NODE TABLE Method (
  id STRING,
  name STRING,
  qualifiedName STRING,
  signature STRING,
  packageName STRING,
  className STRING,
  filePath STRING,
  startLine INT64,
  endLine INT64,
  modifiers STRING[],
  returnType STRING,
  parameters STRING,
  isStatic BOOLEAN,
  PRIMARY KEY (id)
);`;
export const FIELD_SCHEMA = `
CREATE NODE TABLE Field (
  id STRING,
  name STRING,
  type STRING,
  packageName STRING,
  className STRING,
  filePath STRING,
  modifiers STRING[],
  isStatic BOOLEAN,
  PRIMARY KEY (id)
);`;
export const CODE_RELATION_SCHEMA = `
CREATE REL TABLE CodeRelation (
  FROM Project TO Package,
  FROM Package TO Class,
  FROM Class TO Method,
  FROM Class TO Field,
  FROM Method TO Method,
  FROM Class TO Class,
  FROM Class TO Interface,
  FROM File TO Package,
  FROM File TO Class,
  FROM File TO Interface,
  type STRING,
  confidence DOUBLE,
  reason STRING,
  line INT32
);`;
export const JAVA_SCHEMA_QUERIES = [
    CLASS_SCHEMA,
    METHOD_SCHEMA,
    FIELD_SCHEMA,
    CODE_RELATION_SCHEMA,
];
//# sourceMappingURL=schema.js.map