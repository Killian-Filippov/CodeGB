export const JAVA_QUERIES = `
; 类定义
(class_declaration name: (identifier) @name) @definition.class

; 接口定义
(interface_declaration name: (identifier) @name) @definition.interface

; 枚举定义
(enum_declaration name: (identifier) @name) @definition.enum

; 注解定义
(annotation_type_declaration name: (identifier) @name) @definition.annotation

; 方法定义
(method_declaration name: (identifier) @name) @definition.method

; 构造函数
(constructor_declaration name: (identifier) @name) @definition.constructor

; 字段定义
(field_declaration
  declarator: (variable_declarator name: (identifier) @name)) @definition.field

; import 语句
(import_declaration (_) @import.source) @import

; 方法调用
(method_invocation name: (identifier) @call.name) @call
(method_invocation object: (_) name: (identifier) @call.name) @call

; 字段访问
(field_access object: (_) field: (identifier) @field.name) @field

; 类继承
(class_declaration name: (identifier) @heritage.class
  (superclass (type_identifier) @heritage.extends)) @heritage

; 实现接口
(class_declaration name: (identifier) @heritage.class
  (super_interfaces (type_list (type_identifier) @heritage.implements))) @heritage.impl

; 接口继承
(interface_declaration name: (identifier) @heritage.interface
  (extends (type_list (type_identifier) @heritage.extends))) @heritage.ext
`;
//# sourceMappingURL=java-queries.js.map