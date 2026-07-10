// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/omp-publisher.ts
import { existsSync, readFileSync } from "fs";

// src/outbox.ts
import { appendFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join as join2 } from "path";
// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Schema.js
var exports_Schema = {};
__export(exports_Schema, {
  withDecodingDefaultTypeKey: () => withDecodingDefaultTypeKey,
  withDecodingDefaultType: () => withDecodingDefaultType,
  withDecodingDefaultKey: () => withDecodingDefaultKey,
  withDecodingDefault: () => withDecodingDefault,
  withConstructorDefault: () => withConstructorDefault2,
  toType: () => toType2,
  toTaggedUnion: () => toTaggedUnion,
  toStandardSchemaV1: () => toStandardSchemaV1,
  toStandardJSONSchemaV1: () => toStandardJSONSchemaV1,
  toRepresentation: () => toRepresentation,
  toJsonSchemaDocument: () => toJsonSchemaDocument2,
  toIsoSource: () => toIsoSource,
  toIsoFocus: () => toIsoFocus,
  toIso: () => toIso,
  toFormatter: () => toFormatter,
  toEquivalence: () => toEquivalence2,
  toEncoderXml: () => toEncoderXml,
  toEncoded: () => toEncoded2,
  toDifferJsonPatch: () => toDifferJsonPatch,
  toCodecStringTree: () => toCodecStringTree,
  toCodecJson: () => toCodecJson,
  toCodecIso: () => toCodecIso,
  toCodecArrayFromSingle: () => toCodecArrayFromSingle,
  toArbitraryLazy: () => toArbitraryLazy,
  toArbitrary: () => toArbitrary,
  tagDefaultOmit: () => tagDefaultOmit,
  tag: () => tag,
  suspend: () => suspend2,
  revealCodec: () => revealCodec,
  revealBottom: () => revealBottom,
  resolveAnnotationsKey: () => resolveAnnotationsKey,
  resolveAnnotations: () => resolveAnnotations,
  requiredKey: () => requiredKey,
  required: () => required,
  refine: () => refine,
  redact: () => redact3,
  readonlyKey: () => readonlyKey,
  overrideToFormatter: () => overrideToFormatter,
  overrideToEquivalence: () => overrideToEquivalence,
  overrideToCodecIso: () => overrideToCodecIso,
  optionalKey: () => optionalKey2,
  optional: () => optional,
  mutableKey: () => mutableKey2,
  mutable: () => mutable,
  middlewareEncoding: () => middlewareEncoding2,
  middlewareDecoding: () => middlewareDecoding2,
  makeIsMultipleOf: () => makeIsMultipleOf,
  makeIsLessThanOrEqualTo: () => makeIsLessThanOrEqualTo,
  makeIsLessThan: () => makeIsLessThan,
  makeIsGreaterThanOrEqualTo: () => makeIsGreaterThanOrEqualTo,
  makeIsGreaterThan: () => makeIsGreaterThan,
  makeIsBetween: () => makeIsBetween,
  makeFilterGroup: () => makeFilterGroup,
  makeFilter: () => makeFilter2,
  make: () => make18,
  link: () => link,
  isUppercased: () => isUppercased,
  isUnique: () => isUnique,
  isUncapitalized: () => isUncapitalized,
  isUint32: () => isUint32,
  isUUID: () => isUUID,
  isULID: () => isULID,
  isTrimmed: () => isTrimmed,
  isStringSymbol: () => isStringSymbol2,
  isStringFinite: () => isStringFinite2,
  isStringBigInt: () => isStringBigInt2,
  isStartsWith: () => isStartsWith,
  isSizeBetween: () => isSizeBetween,
  isSchemaError: () => isSchemaError,
  isSchema: () => isSchema,
  isPropertyNames: () => isPropertyNames,
  isPropertiesLengthBetween: () => isPropertiesLengthBetween,
  isPattern: () => isPattern2,
  isNonEmpty: () => isNonEmpty,
  isMultipleOf: () => isMultipleOf,
  isMinSize: () => isMinSize,
  isMinProperties: () => isMinProperties,
  isMinLength: () => isMinLength,
  isMaxSize: () => isMaxSize,
  isMaxProperties: () => isMaxProperties,
  isMaxLength: () => isMaxLength,
  isLowercased: () => isLowercased,
  isLessThanOrEqualToDate: () => isLessThanOrEqualToDate,
  isLessThanOrEqualToBigInt: () => isLessThanOrEqualToBigInt,
  isLessThanOrEqualToBigDecimal: () => isLessThanOrEqualToBigDecimal,
  isLessThanOrEqualTo: () => isLessThanOrEqualTo3,
  isLessThanDate: () => isLessThanDate,
  isLessThanBigInt: () => isLessThanBigInt,
  isLessThanBigDecimal: () => isLessThanBigDecimal,
  isLessThan: () => isLessThan4,
  isLengthBetween: () => isLengthBetween,
  isInt32: () => isInt32,
  isInt: () => isInt,
  isIncludes: () => isIncludes,
  isGreaterThanOrEqualToDate: () => isGreaterThanOrEqualToDate,
  isGreaterThanOrEqualToBigInt: () => isGreaterThanOrEqualToBigInt,
  isGreaterThanOrEqualToBigDecimal: () => isGreaterThanOrEqualToBigDecimal,
  isGreaterThanOrEqualTo: () => isGreaterThanOrEqualTo3,
  isGreaterThanDate: () => isGreaterThanDate,
  isGreaterThanBigInt: () => isGreaterThanBigInt,
  isGreaterThanBigDecimal: () => isGreaterThanBigDecimal,
  isGreaterThan: () => isGreaterThan4,
  isGUID: () => isGUID,
  isFinite: () => isFinite,
  isEndsWith: () => isEndsWith,
  isDateValid: () => isDateValid,
  isCapitalized: () => isCapitalized,
  isBetweenDate: () => isBetweenDate,
  isBetweenBigInt: () => isBetweenBigInt,
  isBetweenBigDecimal: () => isBetweenBigDecimal,
  isBetween: () => isBetween2,
  isBase64Url: () => isBase64Url,
  isBase64: () => isBase64,
  is: () => is2,
  instanceOf: () => instanceOf,
  fromURLSearchParams: () => fromURLSearchParams2,
  fromJsonString: () => fromJsonString2,
  fromFormData: () => fromFormData2,
  fromBrand: () => fromBrand,
  flip: () => flip3,
  fieldsAssign: () => fieldsAssign,
  extendTo: () => extendTo,
  encodeUnknownSync: () => encodeUnknownSync2,
  encodeUnknownResult: () => encodeUnknownResult2,
  encodeUnknownPromise: () => encodeUnknownPromise,
  encodeUnknownOption: () => encodeUnknownOption2,
  encodeUnknownExit: () => encodeUnknownExit2,
  encodeUnknownEffect: () => encodeUnknownEffect2,
  encodeTo: () => encodeTo,
  encodeSync: () => encodeSync2,
  encodeResult: () => encodeResult,
  encodePromise: () => encodePromise,
  encodeOption: () => encodeOption2,
  encodeKeys: () => encodeKeys,
  encodeExit: () => encodeExit,
  encodeEffect: () => encodeEffect,
  encode: () => encode,
  decodeUnknownSync: () => decodeUnknownSync2,
  decodeUnknownResult: () => decodeUnknownResult2,
  decodeUnknownPromise: () => decodeUnknownPromise,
  decodeUnknownOption: () => decodeUnknownOption2,
  decodeUnknownExit: () => decodeUnknownExit2,
  decodeUnknownEffect: () => decodeUnknownEffect2,
  decodeTo: () => decodeTo2,
  decodeSync: () => decodeSync2,
  decodeResult: () => decodeResult,
  decodePromise: () => decodePromise,
  decodeOption: () => decodeOption2,
  decodeExit: () => decodeExit,
  decodeEffect: () => decodeEffect2,
  decode: () => decode,
  declareConstructor: () => declareConstructor,
  declare: () => declare,
  check: () => check2,
  catchEncodingWithContext: () => catchEncodingWithContext,
  catchEncoding: () => catchEncoding,
  catchDecodingWithContext: () => catchDecodingWithContext,
  catchDecoding: () => catchDecoding,
  brand: () => brand2,
  asserts: () => asserts2,
  asClass: () => asClass,
  annotateKey: () => annotateKey2,
  annotateEncoded: () => annotateEncoded,
  annotate: () => annotate2,
  Void: () => Void2,
  UnknownFromJsonString: () => UnknownFromJsonString,
  Unknown: () => Unknown2,
  UniqueSymbol: () => UniqueSymbol2,
  UniqueArray: () => UniqueArray,
  Union: () => Union2,
  UndefinedOr: () => UndefinedOr,
  Undefined: () => Undefined2,
  Uint8ArrayFromHex: () => Uint8ArrayFromHex,
  Uint8ArrayFromBase64Url: () => Uint8ArrayFromBase64Url,
  Uint8ArrayFromBase64: () => Uint8ArrayFromBase64,
  Uint8Array: () => Uint8Array2,
  URLSearchParams: () => URLSearchParams2,
  URLFromString: () => URLFromString,
  URL: () => URL2,
  TupleWithRest: () => TupleWithRest,
  Tuple: () => Tuple,
  Trimmed: () => Trimmed,
  Trim: () => Trim,
  Tree: () => Tree,
  TimeZoneOffset: () => TimeZoneOffset,
  TimeZoneNamedFromString: () => TimeZoneNamedFromString,
  TimeZoneNamed: () => TimeZoneNamed,
  TimeZoneFromString: () => TimeZoneFromString,
  TimeZone: () => TimeZone,
  TemplateLiteralParser: () => TemplateLiteralParser,
  TemplateLiteral: () => TemplateLiteral2,
  TaggedUnion: () => TaggedUnion,
  TaggedStruct: () => TaggedStruct,
  TaggedErrorClass: () => TaggedErrorClass,
  TaggedClass: () => TaggedClass,
  Symbol: () => Symbol3,
  StructWithRest: () => StructWithRest,
  Struct: () => Struct,
  StringFromUriComponent: () => StringFromUriComponent,
  StringFromHex: () => StringFromHex,
  StringFromBase64Url: () => StringFromBase64Url,
  StringFromBase64: () => StringFromBase64,
  String: () => String5,
  StandardSchemaV1FailureResult: () => StandardSchemaV1FailureResult,
  SchemaError: () => SchemaError,
  Result: () => Result,
  RegExp: () => RegExp3,
  RedactedFromValue: () => RedactedFromValue,
  Redacted: () => Redacted,
  Record: () => Record,
  ReadonlySet: () => ReadonlySet,
  ReadonlyMap: () => ReadonlyMap,
  PropertyKey: () => PropertyKey,
  OptionFromUndefinedOr: () => OptionFromUndefinedOr,
  OptionFromOptionalNullOr: () => OptionFromOptionalNullOr,
  OptionFromOptionalKey: () => OptionFromOptionalKey,
  OptionFromOptional: () => OptionFromOptional,
  OptionFromNullishOr: () => OptionFromNullishOr,
  OptionFromNullOr: () => OptionFromNullOr,
  Option: () => Option,
  Opaque: () => Opaque,
  ObjectKeyword: () => ObjectKeyword2,
  NumberFromString: () => NumberFromString,
  Number: () => Number6,
  NullishOr: () => NullishOr,
  NullOr: () => NullOr,
  Null: () => Null2,
  NonEmptyString: () => NonEmptyString,
  NonEmptyArray: () => NonEmptyArray,
  Never: () => Never2,
  MutableJson: () => MutableJson2,
  Literals: () => Literals,
  Literal: () => Literal2,
  Json: () => Json2,
  Int: () => Int,
  HashSet: () => HashSet,
  HashMap: () => HashMap,
  FormData: () => FormData2,
  FiniteFromString: () => FiniteFromString,
  Finite: () => Finite,
  File: () => File,
  Exit: () => Exit,
  ErrorClass: () => ErrorClass,
  Error: () => Error3,
  Enum: () => Enum2,
  DurationFromString: () => DurationFromString,
  DurationFromNanos: () => DurationFromNanos,
  DurationFromMillis: () => DurationFromMillis,
  Duration: () => Duration,
  Defect: () => Defect,
  DateValid: () => DateValid,
  DateTimeZonedFromString: () => DateTimeZonedFromString,
  DateTimeZoned: () => DateTimeZoned,
  DateTimeUtcFromString: () => DateTimeUtcFromString,
  DateTimeUtcFromMillis: () => DateTimeUtcFromMillis,
  DateTimeUtcFromDate: () => DateTimeUtcFromDate,
  DateTimeUtc: () => DateTimeUtc,
  DateFromString: () => DateFromString,
  Date: () => Date4,
  Class: () => Class3,
  Chunk: () => Chunk,
  Char: () => Char,
  CauseReason: () => CauseReason,
  Cause: () => Cause,
  BooleanFromBit: () => BooleanFromBit,
  Boolean: () => Boolean4,
  BigIntFromString: () => BigIntFromString,
  BigInt: () => BigInt5,
  BigDecimalFromString: () => BigDecimalFromString,
  BigDecimal: () => BigDecimal,
  ArrayEnsure: () => ArrayEnsure,
  Array: () => ArraySchema,
  Any: () => Any2
});

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Pipeable.js
var pipeArguments = (self, args) => {
  switch (args.length) {
    case 0:
      return self;
    case 1:
      return args[0](self);
    case 2:
      return args[1](args[0](self));
    case 3:
      return args[2](args[1](args[0](self)));
    case 4:
      return args[3](args[2](args[1](args[0](self))));
    case 5:
      return args[4](args[3](args[2](args[1](args[0](self)))));
    case 6:
      return args[5](args[4](args[3](args[2](args[1](args[0](self))))));
    case 7:
      return args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))));
    case 8:
      return args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self))))))));
    case 9:
      return args[8](args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))))));
    default: {
      let ret = self;
      for (let i = 0, len = args.length;i < len; i++) {
        ret = args[i](ret);
      }
      return ret;
    }
  }
};
var Prototype = {
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var Class = /* @__PURE__ */ function() {
  function PipeableBase() {}
  PipeableBase.prototype = Prototype;
  return PipeableBase;
}();

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Function.js
var dual = function(arity, body) {
  if (typeof arity === "function") {
    return function() {
      return arity(arguments) ? body.apply(this, arguments) : (self) => body(self, ...arguments);
    };
  }
  switch (arity) {
    case 0:
    case 1:
      throw new RangeError(`Invalid arity ${arity}`);
    case 2:
      return function(a, b) {
        if (arguments.length >= 2) {
          return body(a, b);
        }
        return function(self) {
          return body(self, a);
        };
      };
    case 3:
      return function(a, b, c) {
        if (arguments.length >= 3) {
          return body(a, b, c);
        }
        return function(self) {
          return body(self, a, b);
        };
      };
    default:
      return function() {
        if (arguments.length >= arity) {
          return body.apply(this, arguments);
        }
        const args = arguments;
        return function(self) {
          return body(self, ...args);
        };
      };
  }
};
var identity = (a) => a;
var constant = (value) => () => value;
var constNull = /* @__PURE__ */ constant(null);
var constUndefined = /* @__PURE__ */ constant(undefined);
var constVoid = constUndefined;
function pipe(a, ...args) {
  return pipeArguments(a, args);
}
function memoize(f) {
  const cache = new WeakMap;
  return (a) => {
    if (cache.has(a)) {
      return cache.get(a);
    }
    const result = f(a);
    cache.set(a, result);
    return result;
  };
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/equal.js
var getAllObjectKeys = (obj) => {
  const keys = new Set(Reflect.ownKeys(obj));
  if (obj.constructor === Object)
    return keys;
  if (obj instanceof Error) {
    keys.delete("stack");
  }
  const proto = Object.getPrototypeOf(obj);
  let current = proto;
  while (current !== null && current !== Object.prototype) {
    const ownKeys = Reflect.ownKeys(current);
    for (let i = 0;i < ownKeys.length; i++) {
      keys.add(ownKeys[i]);
    }
    current = Object.getPrototypeOf(current);
  }
  if (keys.has("constructor") && typeof obj.constructor === "function" && proto === obj.constructor.prototype) {
    keys.delete("constructor");
  }
  return keys;
};
var byReferenceInstances = /* @__PURE__ */ new WeakSet;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Predicate.js
function isString(input) {
  return typeof input === "string";
}
function isNumber(input) {
  return typeof input === "number";
}
function isBoolean(input) {
  return typeof input === "boolean";
}
function isBigInt(input) {
  return typeof input === "bigint";
}
function isSymbol(input) {
  return typeof input === "symbol";
}
function isPropertyKey(u) {
  return isString(u) || isNumber(u) || isSymbol(u);
}
function isFunction(input) {
  return typeof input === "function";
}
function isUndefined(input) {
  return input === undefined;
}
function isNotUndefined(input) {
  return input !== undefined;
}
function isNotNullish(input) {
  return input != null;
}
function isNever(_) {
  return false;
}
function isUnknown(_) {
  return true;
}
function isObject(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
function isObjectKeyword(input) {
  return typeof input === "object" && input !== null || isFunction(input);
}
var hasProperty = /* @__PURE__ */ dual(2, (self, property) => isObjectKeyword(self) && (property in self));
function isError(input) {
  return input instanceof Error;
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Hash.js
var symbol = "~effect/interfaces/Hash";
var hash = (self) => {
  switch (typeof self) {
    case "number":
      return number(self);
    case "bigint":
      return string(self.toString(10));
    case "boolean":
      return string(String(self));
    case "symbol":
      return string(String(self));
    case "string":
      return string(self);
    case "undefined":
      return string("undefined");
    case "function":
    case "object": {
      if (self === null) {
        return string("null");
      } else if (self instanceof Date) {
        return string(self.toISOString());
      } else if (self instanceof RegExp) {
        return string(self.toString());
      } else {
        if (byReferenceInstances.has(self)) {
          return random(self);
        }
        if (hashCache.has(self)) {
          return hashCache.get(self);
        }
        const h = withVisitedTracking(self, () => {
          if (isHash(self)) {
            return self[symbol]();
          } else if (typeof self === "function") {
            return random(self);
          } else if (Array.isArray(self) || ArrayBuffer.isView(self)) {
            return array(self);
          } else if (self instanceof Map) {
            return hashMap(self);
          } else if (self instanceof Set) {
            return hashSet(self);
          }
          return structure(self);
        });
        hashCache.set(self, h);
        return h;
      }
    }
    default:
      throw new Error(`BUG: unhandled typeof ${typeof self} - please report an issue at https://github.com/Effect-TS/effect/issues`);
  }
};
var random = (self) => {
  if (!randomHashCache.has(self)) {
    randomHashCache.set(self, number(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)));
  }
  return randomHashCache.get(self);
};
var combine = /* @__PURE__ */ dual(2, (self, b) => self * 53 ^ b);
var optimize = (n) => n & 3221225471 | n >>> 1 & 1073741824;
var isHash = (u) => hasProperty(u, symbol);
var number = (n) => {
  if (n !== n) {
    return string("NaN");
  }
  if (n === Infinity) {
    return string("Infinity");
  }
  if (n === -Infinity) {
    return string("-Infinity");
  }
  let h = n | 0;
  if (h !== n) {
    h ^= n * 4294967295;
  }
  while (n > 4294967295) {
    h ^= n /= 4294967295;
  }
  return optimize(h);
};
var string = (str) => {
  let h = 5381, i = str.length;
  while (i) {
    h = h * 33 ^ str.charCodeAt(--i);
  }
  return optimize(h);
};
var structureKeys = (o, keys) => {
  let h = 12289;
  for (const key of keys) {
    h ^= combine(hash(key), hash(o[key]));
  }
  return optimize(h);
};
var structure = (o) => structureKeys(o, getAllObjectKeys(o));
var iterableWith = (seed, f) => (iter) => {
  let h = seed;
  for (const element of iter) {
    h ^= f(element);
  }
  return optimize(h);
};
var array = /* @__PURE__ */ iterableWith(6151, hash);
var hashMap = /* @__PURE__ */ iterableWith(/* @__PURE__ */ string("Map"), ([k, v]) => combine(hash(k), hash(v)));
var hashSet = /* @__PURE__ */ iterableWith(/* @__PURE__ */ string("Set"), hash);
var randomHashCache = /* @__PURE__ */ new WeakMap;
var hashCache = /* @__PURE__ */ new WeakMap;
var visitedObjects = /* @__PURE__ */ new WeakSet;
function withVisitedTracking(obj, fn) {
  if (visitedObjects.has(obj)) {
    return string("[Circular]");
  }
  visitedObjects.add(obj);
  const result = fn();
  visitedObjects.delete(obj);
  return result;
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Equal.js
var symbol2 = "~effect/interfaces/Equal";
function equals() {
  if (arguments.length === 1) {
    return (self) => compareBoth(self, arguments[0]);
  }
  return compareBoth(arguments[0], arguments[1]);
}
function compareBoth(self, that) {
  if (self === that)
    return true;
  if (self == null || that == null)
    return false;
  const selfType = typeof self;
  if (selfType !== typeof that) {
    return false;
  }
  if (selfType === "number" && self !== self && that !== that) {
    return true;
  }
  if (selfType !== "object" && selfType !== "function") {
    return false;
  }
  if (byReferenceInstances.has(self) || byReferenceInstances.has(that)) {
    return false;
  }
  return withCache(self, that, compareObjects);
}
function withVisitedTracking2(self, that, fn) {
  const hasLeft = visitedLeft.has(self);
  const hasRight = visitedRight.has(that);
  if (hasLeft && hasRight) {
    return true;
  }
  if (hasLeft || hasRight) {
    return false;
  }
  visitedLeft.add(self);
  visitedRight.add(that);
  const result = fn();
  visitedLeft.delete(self);
  visitedRight.delete(that);
  return result;
}
var visitedLeft = /* @__PURE__ */ new WeakSet;
var visitedRight = /* @__PURE__ */ new WeakSet;
function compareObjects(self, that) {
  if (hash(self) !== hash(that)) {
    return false;
  } else if (self instanceof Date) {
    if (!(that instanceof Date))
      return false;
    return self.toISOString() === that.toISOString();
  } else if (self instanceof RegExp) {
    if (!(that instanceof RegExp))
      return false;
    return self.toString() === that.toString();
  }
  const selfIsEqual = isEqual(self);
  const thatIsEqual = isEqual(that);
  if (selfIsEqual !== thatIsEqual)
    return false;
  const bothEquals = selfIsEqual && thatIsEqual;
  if (typeof self === "function" && !bothEquals) {
    return false;
  }
  return withVisitedTracking2(self, that, () => {
    if (bothEquals) {
      return self[symbol2](that);
    } else if (Array.isArray(self)) {
      if (!Array.isArray(that) || self.length !== that.length) {
        return false;
      }
      return compareArrays(self, that);
    } else if (ArrayBuffer.isView(self)) {
      if (!ArrayBuffer.isView(that) || self.byteLength !== that.byteLength) {
        return false;
      }
      return compareTypedArrays(self, that);
    } else if (self instanceof Map) {
      if (!(that instanceof Map) || self.size !== that.size) {
        return false;
      }
      return compareMaps(self, that);
    } else if (self instanceof Set) {
      if (!(that instanceof Set) || self.size !== that.size) {
        return false;
      }
      return compareSets(self, that);
    }
    return compareRecords(self, that);
  });
}
function withCache(self, that, f) {
  let selfMap = equalityCache.get(self);
  if (!selfMap) {
    selfMap = new WeakMap;
    equalityCache.set(self, selfMap);
  } else if (selfMap.has(that)) {
    return selfMap.get(that);
  }
  const result = f(self, that);
  selfMap.set(that, result);
  let thatMap = equalityCache.get(that);
  if (!thatMap) {
    thatMap = new WeakMap;
    equalityCache.set(that, thatMap);
  }
  thatMap.set(self, result);
  return result;
}
var equalityCache = /* @__PURE__ */ new WeakMap;
function compareArrays(self, that) {
  for (let i = 0;i < self.length; i++) {
    if (!compareBoth(self[i], that[i])) {
      return false;
    }
  }
  return true;
}
function compareTypedArrays(self, that) {
  if (self.length !== that.length) {
    return false;
  }
  for (let i = 0;i < self.length; i++) {
    if (self[i] !== that[i]) {
      return false;
    }
  }
  return true;
}
function compareRecords(self, that) {
  const selfKeys = getAllObjectKeys(self);
  const thatKeys = getAllObjectKeys(that);
  if (selfKeys.size !== thatKeys.size) {
    return false;
  }
  for (const key of selfKeys) {
    if (!thatKeys.has(key) || !compareBoth(self[key], that[key])) {
      return false;
    }
  }
  return true;
}
function makeCompareMap(keyEquivalence, valueEquivalence) {
  return function compareMaps(self, that) {
    for (const [selfKey, selfValue] of self) {
      let found = false;
      for (const [thatKey, thatValue] of that) {
        if (keyEquivalence(selfKey, thatKey) && valueEquivalence(selfValue, thatValue)) {
          found = true;
          break;
        }
      }
      if (!found) {
        return false;
      }
    }
    return true;
  };
}
var compareMaps = /* @__PURE__ */ makeCompareMap(compareBoth, compareBoth);
function makeCompareSet(equivalence) {
  return function compareSets(self, that) {
    for (const selfValue of self) {
      let found = false;
      for (const thatValue of that) {
        if (equivalence(selfValue, thatValue)) {
          found = true;
          break;
        }
      }
      if (!found) {
        return false;
      }
    }
    return true;
  };
}
var compareSets = /* @__PURE__ */ makeCompareSet(compareBoth);
var isEqual = (u) => hasProperty(u, symbol2);
var asEquivalence = () => equals;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Reducer.js
function make(combine2, initialValue, combineAll) {
  return {
    combine: combine2,
    initialValue,
    combineAll: combineAll ?? ((collection) => {
      let out = initialValue;
      for (const value of collection) {
        out = combine2(out, value);
      }
      return out;
    })
  };
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Equivalence.js
var make2 = (isEquivalent) => (self, that) => self === that || isEquivalent(self, that);
function Array_(item) {
  return make2((self, that) => {
    if (self.length !== that.length)
      return false;
    for (let i = 0;i < self.length; i++) {
      if (!item(self[i], that[i]))
        return false;
    }
    return true;
  });
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/array.js
var isArrayNonEmpty = (self) => self.length > 0;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Combiner.js
function make3(combine2) {
  return {
    combine: combine2
  };
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Redactable.js
var symbolRedactable = /* @__PURE__ */ Symbol.for("~effect/Redactable");
var isRedactable = (u) => hasProperty(u, symbolRedactable);
function redact(u) {
  if (isRedactable(u))
    return getRedacted(u);
  return u;
}
function getRedacted(redactable) {
  return redactable[symbolRedactable](globalThis[currentFiberTypeId]?.context ?? emptyContext);
}
var currentFiberTypeId = "~effect/Fiber/currentFiber";
var emptyContext = {
  "~effect/Context": {},
  mapUnsafe: /* @__PURE__ */ new Map,
  pipe() {
    return pipeArguments(this, arguments);
  }
};

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Formatter.js
function format(input, options) {
  const space = options?.space ?? 0;
  const seen = new WeakSet;
  const gap = !space ? "" : typeof space === "number" ? " ".repeat(space) : space;
  const ind = (d) => gap.repeat(d);
  const wrap = (v, body) => {
    const ctor = v?.constructor;
    return ctor && ctor !== Object.prototype.constructor && ctor.name ? `${ctor.name}(${body})` : body;
  };
  const ownKeys = (o) => {
    try {
      return Reflect.ownKeys(o);
    } catch {
      return ["[ownKeys threw]"];
    }
  };
  function recur(v, d = 0) {
    if (Array.isArray(v)) {
      if (seen.has(v))
        return CIRCULAR;
      seen.add(v);
      if (!gap || v.length <= 1)
        return `[${v.map((x) => recur(x, d)).join(",")}]`;
      const inner = v.map((x) => recur(x, d + 1)).join(`,
` + ind(d + 1));
      return `[
${ind(d + 1)}${inner}
${ind(d)}]`;
    }
    if (v instanceof Date)
      return formatDate(v);
    if (!options?.ignoreToString && hasProperty(v, "toString") && typeof v["toString"] === "function" && v["toString"] !== Object.prototype.toString && v["toString"] !== Array.prototype.toString) {
      const s = safeToString(v);
      if (v instanceof Error && v.cause) {
        return `${s} (cause: ${recur(v.cause, d)})`;
      }
      return s;
    }
    if (typeof v === "string")
      return JSON.stringify(v);
    if (typeof v === "number" || v == null || typeof v === "boolean" || typeof v === "symbol")
      return String(v);
    if (typeof v === "bigint")
      return String(v) + "n";
    if (typeof v === "object" || typeof v === "function") {
      if (seen.has(v))
        return CIRCULAR;
      seen.add(v);
      if (symbolRedactable in v)
        return format(getRedacted(v));
      if (Symbol.iterator in v) {
        return `${v.constructor.name}(${recur(Array.from(v), d)})`;
      }
      const keys = ownKeys(v);
      if (!gap || keys.length <= 1) {
        const body2 = `{${keys.map((k) => `${formatPropertyKey(k)}:${recur(v[k], d)}`).join(",")}}`;
        return wrap(v, body2);
      }
      const body = `{
${keys.map((k) => `${ind(d + 1)}${formatPropertyKey(k)}: ${recur(v[k], d + 1)}`).join(`,
`)}
${ind(d)}}`;
      return wrap(v, body);
    }
    return String(v);
  }
  return recur(input, 0);
}
var CIRCULAR = "[Circular]";
function formatPropertyKey(name) {
  return typeof name === "string" ? JSON.stringify(name) : String(name);
}
function formatPath(path) {
  return path.map((key) => `[${formatPropertyKey(key)}]`).join("");
}
function formatDate(date) {
  try {
    return date.toISOString();
  } catch {
    return "Invalid Date";
  }
}
function safeToString(input) {
  try {
    const s = input.toString();
    return typeof s === "string" ? s : String(s);
  } catch {
    return "[toString threw]";
  }
}
function formatJson(input, options) {
  const ancestors = [];
  return JSON.stringify(input, function(_key, value) {
    const redacted = redact(value);
    if (typeof redacted !== "object" || redacted === null) {
      return redacted;
    }
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
      ancestors.pop();
    }
    if (ancestors.includes(redacted)) {
      return;
    }
    ancestors.push(redacted);
    return redacted;
  }, options?.space);
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Inspectable.js
var NodeInspectSymbol = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
var toJson = (input) => {
  try {
    if (hasProperty(input, "toJSON") && isFunction(input["toJSON"]) && input["toJSON"].length === 0) {
      return input.toJSON();
    } else if (Array.isArray(input)) {
      return input.map(toJson);
    }
  } catch {
    return "[toJSON threw]";
  }
  return redact(input);
};
var BaseProto = {
  toJSON() {
    return toJson(this);
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  toString() {
    return format(this.toJSON());
  }
};

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Utils.js
class SingleShotGen {
  called = false;
  self;
  constructor(self) {
    this.self = self;
  }
  next(a) {
    return this.called ? {
      value: a,
      done: true
    } : (this.called = true, {
      value: this.self,
      done: false
    });
  }
  [Symbol.iterator]() {
    return new SingleShotGen(this.self);
  }
}
var pickInternalCall = () => {
  const InternalTypeId = "~effect/Utils/internal";
  const standard = {
    [InternalTypeId]: (body) => {
      return body();
    }
  };
  const forced = {
    [InternalTypeId]: (body) => {
      try {
        return body();
      } finally {}
    }
  };
  const isNotOptimizedAway = standard[InternalTypeId](() => new Error().stack)?.includes(InternalTypeId) === true;
  return isNotOptimizedAway ? standard[InternalTypeId] : forced[InternalTypeId];
};
var internalCall = /* @__PURE__ */ pickInternalCall();

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/core.js
var EffectTypeId = `~effect/Effect`;
var ExitTypeId = `~effect/Exit`;
var effectVariance = {
  _A: identity,
  _E: identity,
  _R: identity
};
var identifier = `${EffectTypeId}/identifier`;
var args = `${EffectTypeId}/args`;
var evaluate = `${EffectTypeId}/evaluate`;
var contA = `${EffectTypeId}/successCont`;
var contE = `${EffectTypeId}/failureCont`;
var contAll = `${EffectTypeId}/ensureCont`;
var Yield = /* @__PURE__ */ Symbol.for("effect/Effect/Yield");
var PipeInspectableProto = {
  pipe() {
    return pipeArguments(this, arguments);
  },
  toJSON() {
    return {
      ...this
    };
  },
  toString() {
    return format(this.toJSON(), {
      ignoreToString: true,
      space: 2
    });
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
};
var StructuralProto = {
  [symbol]() {
    return structureKeys(this, Object.keys(this));
  },
  [symbol2](that) {
    const selfKeys = Object.keys(this);
    const thatKeys = Object.keys(that);
    if (selfKeys.length !== thatKeys.length)
      return false;
    for (let i = 0;i < selfKeys.length; i++) {
      if (selfKeys[i] !== thatKeys[i] && !equals(this[selfKeys[i]], that[selfKeys[i]])) {
        return false;
      }
    }
    return true;
  }
};
var EffectProto = {
  [EffectTypeId]: effectVariance,
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  },
  toJSON() {
    return {
      _id: "Effect",
      op: this[identifier],
      ...args in this ? {
        args: this[args]
      } : undefined
    };
  }
};
var isExit = (u) => hasProperty(u, ExitTypeId);
var CauseTypeId = "~effect/Cause";
var CauseReasonTypeId = "~effect/Cause/Reason";
var isCause = (self) => hasProperty(self, CauseTypeId);
var isCauseReason = (self) => hasProperty(self, CauseReasonTypeId);

class CauseImpl {
  [CauseTypeId];
  reasons;
  constructor(failures) {
    this[CauseTypeId] = CauseTypeId;
    this.reasons = failures;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toJSON() {
    return {
      _id: "Cause",
      failures: this.reasons.map((f) => f.toJSON())
    };
  }
  toString() {
    return `Cause(${format(this.reasons)})`;
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  [symbol2](that) {
    return isCause(that) && this.reasons.length === that.reasons.length && this.reasons.every((e, i) => equals(e, that.reasons[i]));
  }
  [symbol]() {
    return array(this.reasons);
  }
}
var annotationsMap = /* @__PURE__ */ new WeakMap;

class ReasonBase {
  [CauseReasonTypeId];
  annotations;
  _tag;
  constructor(_tag, annotations, originalError) {
    this[CauseReasonTypeId] = CauseReasonTypeId;
    this._tag = _tag;
    if (annotations !== constEmptyAnnotations && typeof originalError === "object" && originalError !== null && annotations.size > 0) {
      const prevAnnotations = annotationsMap.get(originalError);
      if (prevAnnotations) {
        annotations = new Map([...prevAnnotations, ...annotations]);
      }
      annotationsMap.set(originalError, annotations);
    }
    this.annotations = annotations;
  }
  annotate(annotations, options) {
    if (annotations.mapUnsafe.size === 0)
      return this;
    const newAnnotations = new Map(this.annotations);
    annotations.mapUnsafe.forEach((value, key) => {
      if (options?.overwrite !== true && newAnnotations.has(key))
        return;
      newAnnotations.set(key, value);
    });
    const self = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    self.annotations = newAnnotations;
    return self;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toString() {
    return format(this);
  }
  [NodeInspectSymbol]() {
    return this.toString();
  }
}
var constEmptyAnnotations = /* @__PURE__ */ new Map;

class Fail extends ReasonBase {
  error;
  constructor(error, annotations = constEmptyAnnotations) {
    super("Fail", annotations, error);
    this.error = error;
  }
  toString() {
    return `Fail(${format(this.error)})`;
  }
  toJSON() {
    return {
      _tag: "Fail",
      error: this.error
    };
  }
  [symbol2](that) {
    return isFailReason(that) && equals(this.error, that.error) && equals(this.annotations, that.annotations);
  }
  [symbol]() {
    return combine(string(this._tag))(combine(hash(this.error))(hash(this.annotations)));
  }
}
var causeFromReasons = (reasons) => new CauseImpl(reasons);
var causeEmpty = /* @__PURE__ */ new CauseImpl([]);
var causeFail = (error) => new CauseImpl([new Fail(error)]);

class Die extends ReasonBase {
  defect;
  constructor(defect, annotations = constEmptyAnnotations) {
    super("Die", annotations, defect);
    this.defect = defect;
  }
  toString() {
    return `Die(${format(this.defect)})`;
  }
  toJSON() {
    return {
      _tag: "Die",
      defect: this.defect
    };
  }
  [symbol2](that) {
    return isDieReason(that) && equals(this.defect, that.defect) && equals(this.annotations, that.annotations);
  }
  [symbol]() {
    return combine(string(this._tag))(combine(hash(this.defect))(hash(this.annotations)));
  }
}
var causeDie = (defect) => new CauseImpl([new Die(defect)]);
var causeAnnotate = /* @__PURE__ */ dual((args2) => isCause(args2[0]), (self, annotations, options) => {
  if (annotations.mapUnsafe.size === 0)
    return self;
  return new CauseImpl(self.reasons.map((f) => f.annotate(annotations, options)));
});
var isFailReason = (self) => self._tag === "Fail";
var isDieReason = (self) => self._tag === "Die";
var isInterruptReason = (self) => self._tag === "Interrupt";
function defaultEvaluate(_fiber) {
  return exitDie(`Effect.evaluate: Not implemented`);
}
var makePrimitiveProto = (options) => ({
  ...EffectProto,
  [identifier]: options.op,
  [evaluate]: options[evaluate] ?? defaultEvaluate,
  [contA]: options[contA],
  [contE]: options[contE],
  [contAll]: options[contAll]
});
var makePrimitive = (options) => {
  const Proto = makePrimitiveProto(options);
  return function() {
    const self = Object.create(Proto);
    self[args] = options.single === false ? arguments : arguments[0];
    return self;
  };
};
var makeExit = (options) => {
  const Proto = {
    ...makePrimitiveProto(options),
    [ExitTypeId]: ExitTypeId,
    _tag: options.op,
    get [options.prop]() {
      return this[args];
    },
    toString() {
      return `${options.op}(${format(this[args])})`;
    },
    toJSON() {
      return {
        _id: "Exit",
        _tag: options.op,
        [options.prop]: this[args]
      };
    },
    [symbol2](that) {
      return isExit(that) && that._tag === this._tag && equals(this[args], that[args]);
    },
    [symbol]() {
      return combine(string(options.op), hash(this[args]));
    }
  };
  return function(value) {
    const self = Object.create(Proto);
    self[args] = value;
    return self;
  };
};
var exitSucceed = /* @__PURE__ */ makeExit({
  op: "Success",
  prop: "value",
  [evaluate](fiber) {
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](this[args], fiber, this) : fiber.yieldWith(this);
  }
});
var StackTraceKey = {
  key: "effect/Cause/StackTrace"
};
var InterruptorStackTrace = {
  key: "effect/Cause/InterruptorStackTrace"
};
var exitFailCause = /* @__PURE__ */ makeExit({
  op: "Failure",
  prop: "cause",
  [evaluate](fiber) {
    let cause = this[args];
    let annotated = false;
    if (fiber.currentStackFrame) {
      cause = causeAnnotate(cause, {
        mapUnsafe: new Map([[StackTraceKey.key, fiber.currentStackFrame]])
      });
      annotated = true;
    }
    let cont = fiber.getCont(contE);
    while (fiber.interruptible && fiber._interruptedCause && cont) {
      cont = fiber.getCont(contE);
    }
    return cont ? cont[contE](cause, fiber, annotated ? undefined : this) : fiber.yieldWith(annotated ? this : exitFailCause(cause));
  }
});
var exitFail = (e) => exitFailCause(causeFail(e));
var exitDie = (defect) => exitFailCause(causeDie(defect));
var withFiber = /* @__PURE__ */ makePrimitive({
  op: "WithFiber",
  [evaluate](fiber) {
    return this[args](fiber);
  }
});
var YieldableError = /* @__PURE__ */ function() {

  class YieldableError2 extends globalThis.Error {
  }
  const proto = /* @__PURE__ */ makePrimitiveProto({
    op: "YieldableError",
    [evaluate]() {
      return exitFail(this);
    }
  });
  delete proto.toString;
  Object.assign(YieldableError2.prototype, proto);
  return YieldableError2;
}();
var Error2 = /* @__PURE__ */ function() {
  const plainArgsSymbol = /* @__PURE__ */ Symbol.for("effect/Data/Error/plainArgs");
  return class Base extends YieldableError {
    constructor(args2) {
      super(args2?.message, args2?.cause ? {
        cause: args2.cause
      } : undefined);
      if (args2) {
        Object.assign(this, args2);
        Object.defineProperty(this, plainArgsSymbol, {
          value: args2,
          enumerable: false
        });
      }
    }
    toJSON() {
      return {
        ...this[plainArgsSymbol],
        ...this
      };
    }
  };
}();
var TaggedError = (tag) => {

  class Base extends Error2 {
    _tag = tag;
  }
  Base.prototype.name = tag;
  return Base;
};
var DoneTypeId = "~effect/Cause/Done";
var DoneVoid = {
  [DoneTypeId]: DoneTypeId,
  _tag: "Done",
  value: undefined
};

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/option.js
var TypeId = "~effect/data/Option";
var CommonProto = {
  [TypeId]: {
    _A: (_) => _
  },
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SomeProto = /* @__PURE__ */ Object.defineProperty(/* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "Some",
  _op: "Some",
  [symbol2](that) {
    return isOption(that) && isSome(that) && equals(this.value, that.value);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.value));
  },
  toString() {
    return `some(${format(this.value)})`;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag,
      value: toJson(this.value)
    };
  }
}), "valueOrUndefined", {
  get() {
    return this.value;
  }
});
var NoneHash = /* @__PURE__ */ hash("None");
var NoneProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "None",
  _op: "None",
  valueOrUndefined: undefined,
  [symbol2](that) {
    return isOption(that) && isNone(that);
  },
  [symbol]() {
    return NoneHash;
  },
  toString() {
    return `none()`;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag
    };
  }
});
var isOption = (input) => hasProperty(input, TypeId);
var isNone = (fa) => fa._tag === "None";
var isSome = (fa) => fa._tag === "Some";
var none = /* @__PURE__ */ Object.create(NoneProto);
var some = (value) => {
  const a = Object.create(SomeProto);
  a.value = value;
  return a;
};

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/result.js
var TypeId2 = "~effect/data/Result";
var CommonProto2 = {
  [TypeId2]: {
    _A: (_) => _,
    _E: (_) => _
  },
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SuccessProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Success",
  _op: "Success",
  [symbol2](that) {
    return isResult(that) && isSuccess(that) && equals(this.success, that.success);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.success));
  },
  toString() {
    return `success(${format(this.success)})`;
  },
  toJSON() {
    return {
      _id: "Result",
      _tag: this._tag,
      value: toJson(this.success)
    };
  }
});
var FailureProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Failure",
  _op: "Failure",
  [symbol2](that) {
    return isResult(that) && isFailure(that) && equals(this.failure, that.failure);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.failure));
  },
  toString() {
    return `failure(${format(this.failure)})`;
  },
  toJSON() {
    return {
      _id: "Result",
      _tag: this._tag,
      failure: toJson(this.failure)
    };
  }
});
var isResult = (input) => hasProperty(input, TypeId2);
var isFailure = (result) => result._tag === "Failure";
var isSuccess = (result) => result._tag === "Success";
var fail = (failure) => {
  const a = Object.create(FailureProto);
  a.failure = failure;
  return a;
};
var succeed = (success) => {
  const a = Object.create(SuccessProto);
  a.success = success;
  return a;
};

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Order.js
function make4(compare) {
  return (self, that) => self === that ? 0 : compare(self, that);
}
var Number2 = /* @__PURE__ */ make4((self, that) => {
  if (globalThis.Number.isNaN(self) && globalThis.Number.isNaN(that))
    return 0;
  if (globalThis.Number.isNaN(self))
    return -1;
  if (globalThis.Number.isNaN(that))
    return 1;
  return self < that ? -1 : 1;
});
var BigInt2 = /* @__PURE__ */ make4((self, that) => self < that ? -1 : 1);
var mapInput = /* @__PURE__ */ dual(2, (self, f) => make4((b1, b2) => self(f(b1), f(b2))));
var Date2 = /* @__PURE__ */ mapInput(Number2, (date) => date.getTime());
var isLessThan = (O) => dual(2, (self, that) => O(self, that) === -1);
var isGreaterThan = (O) => dual(2, (self, that) => O(self, that) === 1);
var isLessThanOrEqualTo = (O) => dual(2, (self, that) => O(self, that) !== 1);
var isGreaterThanOrEqualTo = (O) => dual(2, (self, that) => O(self, that) !== -1);

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Option.js
var none2 = () => none;
var some2 = some;
var isOption2 = isOption;
var isNone2 = isNone;
var isSome2 = isSome;
var match = /* @__PURE__ */ dual(2, (self, {
  onNone,
  onSome
}) => isNone2(self) ? onNone() : onSome(self.value));
var getOrElse = /* @__PURE__ */ dual(2, (self, onNone) => isNone2(self) ? onNone() : self.value);
var fromNullishOr = (a) => a == null ? none2() : some2(a);
var fromUndefinedOr = (a) => a === undefined ? none2() : some2(a);
var fromNullOr = (a) => a === null ? none2() : some2(a);
var getOrNull = /* @__PURE__ */ getOrElse(constNull);
var getOrUndefined = /* @__PURE__ */ getOrElse(constUndefined);
var liftThrowable = (f) => (...a) => {
  try {
    return some2(f(...a));
  } catch {
    return none2();
  }
};
var map = /* @__PURE__ */ dual(2, (self, f) => isNone2(self) ? none2() : some2(f(self.value)));
var flatMap = /* @__PURE__ */ dual(2, (self, f) => isNone2(self) ? none2() : f(self.value));
var flatten = /* @__PURE__ */ flatMap(identity);
var filter = /* @__PURE__ */ dual(2, (self, predicate) => isNone2(self) ? none2() : predicate(self.value) ? some2(self.value) : none2());
var makeEquivalence = (isEquivalent) => make2((x, y) => isNone2(x) ? isNone2(y) : isNone2(y) ? false : isEquivalent(x.value, y.value));

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Result.js
var succeed2 = succeed;
var fail2 = fail;
var isResult2 = isResult;
var isFailure2 = isFailure;
var isSuccess2 = isSuccess;
var makeEquivalence2 = (success, failure) => make2((x, y) => isFailure2(x) ? isFailure2(y) && failure(x.failure, y.failure) : isSuccess2(y) && success(x.success, y.success));
var mapError = /* @__PURE__ */ dual(2, (self, f) => isFailure2(self) ? fail2(f(self.failure)) : succeed2(self.success));
var map2 = /* @__PURE__ */ dual(2, (self, f) => isSuccess2(self) ? succeed2(f(self.success)) : fail2(self.failure));
var match2 = /* @__PURE__ */ dual(2, (self, {
  onFailure,
  onSuccess
}) => isFailure2(self) ? onFailure(self.failure) : onSuccess(self.success));
var getOrElse2 = /* @__PURE__ */ dual(2, (self, onFailure) => isFailure2(self) ? onFailure(self.failure) : self.success);
var flatMap2 = /* @__PURE__ */ dual(2, (self, f) => isFailure2(self) ? fail2(self.failure) : f(self.success));

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Record.js
var empty = () => ({});
var isEmptyRecord = (self) => Object.keys(self).length === 0;
var map3 = /* @__PURE__ */ dual(2, (self, f) => {
  const out = {
    ...self
  };
  for (const key of keys(self)) {
    out[key] = f(self[key], key);
  }
  return out;
});
var filter2 = /* @__PURE__ */ dual(2, (self, predicate) => {
  const out = empty();
  for (const key of keys(self)) {
    if (predicate(self[key], key)) {
      out[key] = self[key];
    }
  }
  return out;
});
var keys = (self) => Object.keys(self);

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Array.js
var Array2 = globalThis.Array;
var fromIterable = (collection) => Array2.isArray(collection) ? collection : Array2.from(collection);
var ensure = (self) => Array2.isArray(self) ? self : [self];
var append = /* @__PURE__ */ dual(2, (self, last) => [...self, last]);
var appendAll = /* @__PURE__ */ dual(2, (self, that) => fromIterable(self).concat(fromIterable(that)));
var isArray = Array2.isArray;
var isArrayNonEmpty2 = isArrayNonEmpty;
var isReadonlyArrayNonEmpty = isArrayNonEmpty;
function isOutOfBounds(i, as) {
  return i < 0 || i >= as.length;
}
var getUnsafe = /* @__PURE__ */ dual(2, (self, index) => {
  const i = Math.floor(index);
  if (isOutOfBounds(i, self)) {
    throw new Error(`Index out of bounds: ${i}`);
  }
  return self[i];
});
var headNonEmpty = /* @__PURE__ */ getUnsafe(0);
var tailNonEmpty = (self) => self.slice(1);
var unionWith = /* @__PURE__ */ dual(3, (self, that, isEquivalent) => {
  const a = fromIterable(self);
  const b = fromIterable(that);
  if (isReadonlyArrayNonEmpty(a)) {
    if (isReadonlyArrayNonEmpty(b)) {
      const dedupe = dedupeWith(isEquivalent);
      return dedupe(appendAll(a, b));
    }
    return a;
  }
  return b;
});
var union = /* @__PURE__ */ dual(2, (self, that) => unionWith(self, that, asEquivalence()));
var empty2 = () => [];
var map4 = /* @__PURE__ */ dual(2, (self, f) => self.map(f));
var getSomes = (self) => {
  const out = [];
  for (const a of self) {
    if (isSome2(a)) {
      out.push(a.value);
    }
  }
  return out;
};
var dedupeWith = /* @__PURE__ */ dual(2, (self, isEquivalent) => {
  const input = fromIterable(self);
  if (isReadonlyArrayNonEmpty(input)) {
    const out = [headNonEmpty(input)];
    const rest = tailNonEmpty(input);
    for (const r of rest) {
      if (out.every((a) => !isEquivalent(r, a))) {
        out.push(r);
      }
    }
    return out;
  }
  return [];
});
var reducer = /* @__PURE__ */ make((a, b) => a.concat(b), []);
function makeReducerConcat() {
  return reducer;
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/BigDecimal.js
var FINITE_INT_REGEXP = /^[+-]?\d+$/;
var TypeId3 = "~effect/BigDecimal";
var BigDecimalProto = {
  [TypeId3]: TypeId3,
  [symbol]() {
    const normalized = normalize(this);
    return combine(hash(normalized.value), number(normalized.scale));
  },
  [symbol2](that) {
    return isBigDecimal(that) && equals2(this, that);
  },
  toString() {
    return `BigDecimal(${format2(this)})`;
  },
  toJSON() {
    return {
      _id: "BigDecimal",
      value: String(this.value),
      scale: this.scale
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var isBigDecimal = (u) => hasProperty(u, TypeId3);
var make5 = (value, scale) => {
  const o = Object.create(BigDecimalProto);
  o.value = value;
  o.scale = scale;
  return o;
};
var makeNormalizedUnsafe = (value, scale) => {
  if (value !== bigint0 && value % bigint10 === bigint0) {
    throw new RangeError("Value must be normalized");
  }
  const o = make5(value, scale);
  o.normalized = o;
  return o;
};
var bigint0 = /* @__PURE__ */ BigInt(0);
var bigint1 = /* @__PURE__ */ BigInt(1);
var bigint_1 = /* @__PURE__ */ BigInt(-1);
var bigint10 = /* @__PURE__ */ BigInt(10);
var zero = /* @__PURE__ */ makeNormalizedUnsafe(bigint0, 0);
var normalize = (self) => {
  if (self.normalized === undefined) {
    if (self.value === bigint0) {
      self.normalized = zero;
    } else {
      const digits = `${self.value}`;
      let trail = 0;
      for (let i = digits.length - 1;i >= 0; i--) {
        if (digits[i] === "0") {
          trail++;
        } else {
          break;
        }
      }
      if (trail === 0) {
        self.normalized = self;
      }
      const value = BigInt(digits.substring(0, digits.length - trail));
      const scale = self.scale - trail;
      self.normalized = makeNormalizedUnsafe(value, scale);
    }
  }
  return self.normalized;
};
var scale = /* @__PURE__ */ dual(2, (self, scale2) => {
  if (scale2 > self.scale) {
    return make5(self.value * bigint10 ** BigInt(scale2 - self.scale), scale2);
  }
  if (scale2 < self.scale) {
    return make5(self.value / bigint10 ** BigInt(self.scale - scale2), scale2);
  }
  return self;
});
var sum = /* @__PURE__ */ dual(2, (self, that) => {
  if (that.value === bigint0) {
    return self;
  }
  if (self.value === bigint0) {
    return that;
  }
  if (self.scale > that.scale) {
    return make5(scale(that, self.scale).value + self.value, self.scale);
  }
  if (self.scale < that.scale) {
    return make5(scale(self, that.scale).value + that.value, that.scale);
  }
  return make5(self.value + that.value, self.scale);
});
var Order = /* @__PURE__ */ make4((self, that) => {
  const scmp = Number2(sign(self), sign(that));
  if (scmp !== 0) {
    return scmp;
  }
  if (self.scale > that.scale) {
    return BigInt2(self.value, scale(that, self.scale).value);
  }
  if (self.scale < that.scale) {
    return BigInt2(scale(self, that.scale).value, that.value);
  }
  return BigInt2(self.value, that.value);
});
var isLessThan2 = /* @__PURE__ */ isLessThan(Order);
var isGreaterThan2 = /* @__PURE__ */ isGreaterThan(Order);
var sign = (n) => n.value === bigint0 ? 0 : n.value < bigint0 ? -1 : 1;
var abs = (n) => n.value < bigint0 ? make5(-n.value, n.scale) : n;
var Equivalence = /* @__PURE__ */ make2((self, that) => {
  if (self.scale > that.scale) {
    return scale(that, self.scale).value === self.value;
  }
  if (self.scale < that.scale) {
    return scale(self, that.scale).value === that.value;
  }
  return self.value === that.value;
});
var equals2 = /* @__PURE__ */ dual(2, (self, that) => Equivalence(self, that));
var fromString = (s) => {
  if (s === "") {
    return some2(zero);
  }
  let base;
  let exp;
  const seperator = s.search(/[eE]/);
  if (seperator !== -1) {
    const trail = s.slice(seperator + 1);
    base = s.slice(0, seperator);
    exp = Number(trail);
    if (base === "" || !Number.isSafeInteger(exp) || !FINITE_INT_REGEXP.test(trail)) {
      return none2();
    }
  } else {
    base = s;
    exp = 0;
  }
  let digits;
  let offset;
  const dot = base.search(/\./);
  if (dot !== -1) {
    const lead = base.slice(0, dot);
    const trail = base.slice(dot + 1);
    digits = `${lead}${trail}`;
    offset = trail.length;
  } else {
    digits = base;
    offset = 0;
  }
  if (!FINITE_INT_REGEXP.test(digits)) {
    return none2();
  }
  const scale2 = offset - exp;
  if (!Number.isSafeInteger(scale2)) {
    return none2();
  }
  return some2(make5(BigInt(digits), scale2));
};
var format2 = (n) => {
  const normalized = normalize(n);
  if (Math.abs(normalized.scale) >= 16) {
    return toExponential(normalized);
  }
  const negative = normalized.value < bigint0;
  const absolute = negative ? `${normalized.value}`.substring(1) : `${normalized.value}`;
  let before;
  let after;
  if (normalized.scale >= absolute.length) {
    before = "0";
    after = "0".repeat(normalized.scale - absolute.length) + absolute;
  } else {
    const location = absolute.length - normalized.scale;
    if (location > absolute.length) {
      const zeros = location - absolute.length;
      before = `${absolute}${"0".repeat(zeros)}`;
      after = "";
    } else {
      after = absolute.slice(location);
      before = absolute.slice(0, location);
    }
  }
  const complete = after === "" ? before : `${before}.${after}`;
  return negative ? `-${complete}` : complete;
};
var toExponential = (n) => {
  if (isZero(n)) {
    return "0e+0";
  }
  const normalized = normalize(n);
  const digits = `${abs(normalized).value}`;
  const head = digits.slice(0, 1);
  const tail = digits.slice(1);
  let output = `${isNegative(normalized) ? "-" : ""}${head}`;
  if (tail !== "") {
    output += `.${tail}`;
  }
  const exp = tail.length - normalized.scale;
  return `${output}e${exp >= 0 ? "+" : ""}${exp}`;
};
var isZero = (n) => n.value === bigint0;
var isNegative = (n) => n.value < bigint0;
var isPositive = (n) => n.value > bigint0;
var isBigDecimalArgs = (args2) => isBigDecimal(args2[0]);
var truncate = /* @__PURE__ */ dual(isBigDecimalArgs, (self, scale2 = 0) => {
  if (self.scale <= scale2) {
    return self;
  }
  return make5(self.value / bigint10 ** BigInt(self.scale - scale2), scale2);
});
var ceil = /* @__PURE__ */ dual(isBigDecimalArgs, (self, scale2 = 0) => {
  const truncated = truncate(self, scale2);
  if (isPositive(self) && isLessThan2(truncated, self)) {
    return sum(truncated, make5(bigint1, scale2));
  }
  return truncated;
});
var floor = /* @__PURE__ */ dual(isBigDecimalArgs, (self, scale2 = 0) => {
  const truncated = truncate(self, scale2);
  if (isNegative(self) && isGreaterThan2(truncated, self)) {
    return sum(truncated, make5(bigint_1, scale2));
  }
  return truncated;
});

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Effectable.js
var Prototype2 = (options) => makePrimitiveProto({
  op: options.label,
  [evaluate]: options.evaluate
});

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/stackTraceLimit.js
var ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
var ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
var ObjectIsExtensible = Object.isExtensible;
var isStackTraceLimitWritable = () => {
  const desc = ObjectGetOwnPropertyDescriptor(Error, "stackTraceLimit");
  if (desc === undefined) {
    return ObjectIsExtensible(Error);
  }
  return ObjectPrototypeHasOwnProperty.call(desc, "writable") ? desc.writable === true : desc.set !== undefined;
};
var canWriteStackTraceLimit = /* @__PURE__ */ isStackTraceLimitWritable();
var getStackTraceLimit = () => Error.stackTraceLimit;
var setStackTraceLimit = (value) => {
  if (canWriteStackTraceLimit) {
    Error.stackTraceLimit = value;
  }
};

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Context.js
var ServiceTypeId = "~effect/Context/Service";
var Service = function() {
  const prevLimit = getStackTraceLimit();
  setStackTraceLimit(2);
  const err = new Error;
  setStackTraceLimit(prevLimit);
  function KeyClass() {}
  const self = KeyClass;
  Object.setPrototypeOf(self, ServiceProto);
  Object.defineProperty(self, "stack", {
    get() {
      return err.stack;
    }
  });
  if (arguments.length > 0) {
    self.key = arguments[0];
    if (arguments[1]?.defaultValue) {
      self[ReferenceTypeId] = ReferenceTypeId;
      self.defaultValue = arguments[1].defaultValue;
    }
    return self;
  }
  return function(key, options) {
    self.key = key;
    if (options?.make) {
      self.make = options.make;
    }
    return self;
  };
};
var ServiceProto = {
  [ServiceTypeId]: ServiceTypeId,
  .../* @__PURE__ */ Prototype2({
    label: "Service",
    evaluate(fiber) {
      return exitSucceed(get(fiber.context, this));
    }
  }),
  toJSON() {
    return {
      _id: "Service",
      key: this.key,
      stack: this.stack
    };
  },
  of(self) {
    return self;
  },
  context(self) {
    return make6(this, self);
  },
  use(f) {
    return withFiber((fiber) => f(get(fiber.context, this)));
  },
  useSync(f) {
    return withFiber((fiber) => exitSucceed(f(get(fiber.context, this))));
  }
};
var ReferenceTypeId = "~effect/Context/Reference";
var TypeId4 = "~effect/Context";
var makeUnsafe = (mapUnsafe) => {
  const self = Object.create(Proto);
  self.mapUnsafe = mapUnsafe;
  self.mutable = false;
  return self;
};
var Proto = {
  ...PipeInspectableProto,
  [TypeId4]: {
    _Services: (_) => _
  },
  toJSON() {
    return {
      _id: "Context",
      services: Array.from(this.mapUnsafe).map(([key, value]) => ({
        key,
        value
      }))
    };
  },
  [symbol2](that) {
    if (!isContext(that) || this.mapUnsafe.size !== that.mapUnsafe.size)
      return false;
    for (const k of this.mapUnsafe.keys()) {
      if (!that.mapUnsafe.has(k) || !equals(this.mapUnsafe.get(k), that.mapUnsafe.get(k))) {
        return false;
      }
    }
    return true;
  },
  [symbol]() {
    return number(this.mapUnsafe.size);
  }
};
var isContext = (u) => hasProperty(u, TypeId4);
var empty3 = () => emptyContext2;
var emptyContext2 = /* @__PURE__ */ makeUnsafe(/* @__PURE__ */ new Map);
var make6 = (key, service) => makeUnsafe(new Map([[key.key, service]]));
var add = /* @__PURE__ */ dual(3, (self, key, service) => withMapUnsafe(self, (map5) => {
  map5.set(key.key, service);
}));
var getUnsafe2 = /* @__PURE__ */ dual(2, (self, service) => {
  if (!self.mapUnsafe.has(service.key)) {
    if (ReferenceTypeId in service)
      return getDefaultValue(service);
    throw serviceNotFoundError(service);
  }
  return self.mapUnsafe.get(service.key);
});
var get = getUnsafe2;
var getReferenceUnsafe = (self, service) => {
  if (!self.mapUnsafe.has(service.key)) {
    return getDefaultValue(service);
  }
  return self.mapUnsafe.get(service.key);
};
var defaultValueCacheKey = "~effect/Context/defaultValue";
var getDefaultValue = (ref) => {
  if (defaultValueCacheKey in ref) {
    return ref[defaultValueCacheKey];
  }
  return ref[defaultValueCacheKey] = ref.defaultValue();
};
var serviceNotFoundError = (service) => {
  const error = new Error(`Service not found${service.key ? `: ${String(service.key)}` : ""}`);
  if (service.stack) {
    const lines = service.stack.split(`
`);
    if (lines.length > 2) {
      const afterAt = lines[2].match(/at (.*)/);
      if (afterAt) {
        error.message = error.message + ` (defined at ${afterAt[1]})`;
      }
    }
  }
  if (error.stack) {
    const lines = error.stack.split(`
`);
    lines.splice(1, 3);
    error.stack = lines.join(`
`);
  }
  return error;
};
var withMapUnsafe = (self, f) => {
  if (self.mutable) {
    f(self.mapUnsafe);
    return self;
  }
  const map5 = new Map(self.mapUnsafe);
  f(map5);
  return makeUnsafe(map5);
};
var Reference = Service;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Duration.js
var TypeId5 = "~effect/time/Duration";
var bigint02 = /* @__PURE__ */ BigInt(0);
var bigint12 = /* @__PURE__ */ BigInt(1);
var bigint1e3 = /* @__PURE__ */ BigInt(1000);
var roundTiesAwayFromZero = (input) => BigInt(input < 0 ? Math.ceil(input - 0.5) : Math.floor(input + 0.5));
var roundMillisToNanos = (millis) => roundTiesAwayFromZero(millis * 1e6);
var parseNanos = (input, scale2) => input.includes(".") ? roundTiesAwayFromZero(Number(input) * Number(scale2)) : BigInt(input) * scale2;
var DURATION_REGEXP = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/;
var fromInputUnsafe = (input) => {
  switch (typeof input) {
    case "number":
      return millis(input);
    case "bigint":
      return nanos(input);
    case "string": {
      if (input === "Infinity") {
        return infinity;
      }
      if (input === "-Infinity") {
        return negativeInfinity;
      }
      const match3 = DURATION_REGEXP.exec(input);
      if (!match3)
        break;
      const [_, valueStr, unit] = match3;
      if (unit === "nano" || unit === "nanos") {
        return nanos(parseNanos(valueStr, bigint12));
      }
      if (unit === "micro" || unit === "micros") {
        return nanos(parseNanos(valueStr, bigint1e3));
      }
      const value = Number(valueStr);
      switch (unit) {
        case "milli":
        case "millis":
          return millis(value);
        case "second":
        case "seconds":
          return seconds(value);
        case "minute":
        case "minutes":
          return minutes(value);
        case "hour":
        case "hours":
          return hours(value);
        case "day":
        case "days":
          return days(value);
        case "week":
        case "weeks":
          return weeks(value);
      }
      break;
    }
    case "object": {
      if (input === null)
        break;
      if (TypeId5 in input)
        return input;
      if (Array.isArray(input)) {
        if (input.length !== 2 || !input.every(isNumber)) {
          return invalid(input);
        }
        if (Number.isNaN(input[0]) || Number.isNaN(input[1])) {
          return zero2;
        }
        if (input[0] === -Infinity || input[1] === -Infinity) {
          return negativeInfinity;
        }
        if (input[0] === Infinity || input[1] === Infinity) {
          return infinity;
        }
        return make7(roundTiesAwayFromZero(input[0] * 1e9 + input[1]));
      }
      const obj = input;
      let millis = 0;
      if (obj.weeks)
        millis += obj.weeks * 604800000;
      if (obj.days)
        millis += obj.days * 86400000;
      if (obj.hours)
        millis += obj.hours * 3600000;
      if (obj.minutes)
        millis += obj.minutes * 60000;
      if (obj.seconds)
        millis += obj.seconds * 1000;
      if (obj.milliseconds)
        millis += obj.milliseconds;
      if (!obj.microseconds && !obj.nanoseconds)
        return make7(millis);
      return make7(roundTiesAwayFromZero(millis * 1e6 + (obj.microseconds ?? 0) * 1000 + (obj.nanoseconds ?? 0)));
    }
  }
  return invalid(input);
};
var invalid = (input) => {
  throw new Error(`Invalid Input: ${input}`);
};
var fromInput = /* @__PURE__ */ liftThrowable(fromInputUnsafe);
var zeroDurationValue = {
  _tag: "Millis",
  millis: 0
};
var infinityDurationValue = {
  _tag: "Infinity"
};
var negativeInfinityDurationValue = {
  _tag: "NegativeInfinity"
};
var DurationProto = {
  [TypeId5]: TypeId5,
  [symbol]() {
    return structure(this.value);
  },
  [symbol2](that) {
    return isDuration(that) && equals3(this, that);
  },
  toString() {
    switch (this.value._tag) {
      case "Infinity":
        return "Infinity";
      case "NegativeInfinity":
        return "-Infinity";
      case "Nanos":
        return `${this.value.nanos} nanos`;
      case "Millis":
        return `${this.value.millis} millis`;
    }
  },
  toJSON() {
    switch (this.value._tag) {
      case "Millis":
        return {
          _id: "Duration",
          _tag: "Millis",
          millis: this.value.millis
        };
      case "Nanos":
        return {
          _id: "Duration",
          _tag: "Nanos",
          nanos: String(this.value.nanos)
        };
      case "Infinity":
        return {
          _id: "Duration",
          _tag: "Infinity"
        };
      case "NegativeInfinity":
        return {
          _id: "Duration",
          _tag: "NegativeInfinity"
        };
    }
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var make7 = (input) => {
  const duration = Object.create(DurationProto);
  if (typeof input === "number") {
    if (isNaN(input) || input === 0 || Object.is(input, -0)) {
      duration.value = zeroDurationValue;
    } else if (!Number.isFinite(input)) {
      duration.value = input > 0 ? infinityDurationValue : negativeInfinityDurationValue;
    } else if (!Number.isInteger(input)) {
      duration.value = {
        _tag: "Nanos",
        nanos: roundMillisToNanos(input)
      };
    } else {
      duration.value = {
        _tag: "Millis",
        millis: input
      };
    }
  } else if (input === bigint02) {
    duration.value = zeroDurationValue;
  } else {
    duration.value = {
      _tag: "Nanos",
      nanos: input
    };
  }
  return duration;
};
var isDuration = (u) => hasProperty(u, TypeId5);
var zero2 = /* @__PURE__ */ make7(0);
var infinity = /* @__PURE__ */ make7(Infinity);
var negativeInfinity = /* @__PURE__ */ make7(-Infinity);
var nanos = (nanos2) => make7(nanos2);
var millis = (millis2) => make7(millis2);
var seconds = (seconds2) => make7(seconds2 * 1000);
var minutes = (minutes2) => make7(minutes2 * 60000);
var hours = (hours2) => make7(hours2 * 3600000);
var days = (days2) => make7(days2 * 86400000);
var weeks = (weeks2) => make7(weeks2 * 604800000);
var toMillis = (self) => match3(fromInputUnsafe(self), {
  onMillis: identity,
  onNanos: (nanos2) => Number(nanos2) / 1e6,
  onInfinity: () => Infinity,
  onNegativeInfinity: () => -Infinity
});
var toNanosUnsafe = (input) => {
  const self = fromInputUnsafe(input);
  switch (self.value._tag) {
    case "Infinity":
    case "NegativeInfinity":
      throw new Error("Cannot convert infinite duration to nanos");
    case "Nanos":
      return self.value.nanos;
    case "Millis":
      return roundMillisToNanos(self.value.millis);
  }
};
var toNanos = /* @__PURE__ */ liftThrowable(toNanosUnsafe);
var match3 = /* @__PURE__ */ dual(2, (self, options) => {
  switch (self.value._tag) {
    case "Millis":
      return options.onMillis(self.value.millis);
    case "Nanos":
      return options.onNanos(self.value.nanos);
    case "Infinity":
      return options.onInfinity();
    case "NegativeInfinity":
      return (options.onNegativeInfinity ?? options.onInfinity)();
  }
});
var matchPair = /* @__PURE__ */ dual(3, (self, that, options) => {
  if (self.value._tag === "Infinity" || self.value._tag === "NegativeInfinity" || that.value._tag === "Infinity" || that.value._tag === "NegativeInfinity")
    return options.onInfinity(self, that);
  if (self.value._tag === "Millis") {
    return that.value._tag === "Millis" ? options.onMillis(self.value.millis, that.value.millis) : options.onNanos(toNanosUnsafe(self), that.value.nanos);
  } else {
    return options.onNanos(self.value.nanos, toNanosUnsafe(that));
  }
});
var Equivalence2 = (self, that) => matchPair(self, that, {
  onMillis: (self2, that2) => self2 === that2,
  onNanos: (self2, that2) => self2 === that2,
  onInfinity: (self2, that2) => self2.value._tag === that2.value._tag
});
var equals3 = /* @__PURE__ */ dual(2, (self, that) => Equivalence2(self, that));

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Scheduler.js
var Scheduler = /* @__PURE__ */ Reference("effect/Scheduler", {
  defaultValue: () => new MixedScheduler
});
var setImmediate = "setImmediate" in globalThis ? (f) => {
  const timer = globalThis.setImmediate(f);
  return () => globalThis.clearImmediate(timer);
} : (f) => {
  const timer = setTimeout(f, 0);
  return () => clearTimeout(timer);
};

class PriorityBuckets {
  buckets = [];
  scheduleTask(task, priority) {
    const buckets = this.buckets;
    const len = buckets.length;
    let bucket;
    let index = 0;
    for (;index < len; index++) {
      if (buckets[index][0] > priority)
        break;
      bucket = buckets[index];
    }
    if (bucket && bucket[0] === priority) {
      bucket[1].push(task);
    } else if (index === len) {
      buckets.push([priority, [task]]);
    } else {
      buckets.splice(index, 0, [priority, [task]]);
    }
  }
  drain() {
    const buckets = this.buckets;
    this.buckets = [];
    return buckets;
  }
}

class MixedScheduler {
  executionMode;
  setImmediate;
  constructor(executionMode = "async", setImmediateFn = setImmediate) {
    this.executionMode = executionMode;
    this.setImmediate = setImmediateFn;
  }
  shouldYield(fiber) {
    return fiber.currentOpCount >= fiber.maxOpsBeforeYield;
  }
  makeDispatcher() {
    return new MixedSchedulerDispatcher(this.setImmediate);
  }
}

class MixedSchedulerDispatcher {
  tasks = /* @__PURE__ */ new PriorityBuckets;
  running = undefined;
  setImmediate;
  constructor(setImmediateFn = setImmediate) {
    this.setImmediate = setImmediateFn;
  }
  scheduleTask(task, priority) {
    this.tasks.scheduleTask(task, priority);
    if (this.running === undefined) {
      this.running = this.setImmediate(this.afterScheduled);
    }
  }
  afterScheduled = () => {
    this.running = undefined;
    this.runTasks();
  };
  runTasks() {
    const buckets = this.tasks.drain();
    for (let i = 0;i < buckets.length; i++) {
      const toRun = buckets[i][1];
      for (let j = 0;j < toRun.length; j++) {
        toRun[j]();
      }
    }
  }
  flush() {
    while (this.tasks.buckets.length > 0) {
      if (this.running !== undefined) {
        this.running();
        this.running = undefined;
      }
      this.runTasks();
    }
  }
}
var MaxOpsBeforeYield = /* @__PURE__ */ Reference("effect/Scheduler/MaxOpsBeforeYield", {
  defaultValue: () => 2048
});
var PreventSchedulerYield = /* @__PURE__ */ Reference("effect/Scheduler/PreventSchedulerYield", {
  defaultValue: () => false
});

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Tracer.js
var ParentSpanKey = "effect/Tracer/ParentSpan";
var TracerKey = "effect/Tracer";

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/metric.js
var FiberRuntimeMetricsKey = "effect/observability/Metric/FiberRuntimeMetricsKey";

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/references.js
var CurrentStackFrame = /* @__PURE__ */ Reference("effect/References/CurrentStackFrame", {
  defaultValue: constUndefined
});
var CurrentLogLevel = /* @__PURE__ */ Reference("effect/References/CurrentLogLevel", {
  defaultValue: () => "Info"
});
var MinimumLogLevel = /* @__PURE__ */ Reference("effect/References/MinimumLogLevel", {
  defaultValue: () => "Info"
});

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/version.js
var version = "dev";

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/effect.js
class Interrupt extends ReasonBase {
  fiberId;
  constructor(fiberId, annotations = constEmptyAnnotations) {
    super("Interrupt", annotations, "Interrupted");
    this.fiberId = fiberId;
  }
  toString() {
    return `Interrupt(${this.fiberId})`;
  }
  toJSON() {
    return {
      _tag: "Interrupt",
      fiberId: this.fiberId
    };
  }
  [symbol2](that) {
    return isInterruptReason(that) && this.fiberId === that.fiberId && this.annotations === that.annotations;
  }
  [symbol]() {
    return combine(string(`${this._tag}:${this.fiberId}`))(random(this.annotations));
  }
}
var makeInterruptReason = (fiberId) => new Interrupt(fiberId);
var causeInterrupt = (fiberId) => new CauseImpl([new Interrupt(fiberId)]);
var findError = (self) => {
  for (let i = 0;i < self.reasons.length; i++) {
    const reason = self.reasons[i];
    if (reason._tag === "Fail") {
      return succeed2(reason.error);
    }
  }
  return fail2(self);
};
var hasInterrupts = (self) => self.reasons.some(isInterruptReason);
var causeCombine = /* @__PURE__ */ dual(2, (self, that) => {
  if (self.reasons.length === 0) {
    return that;
  } else if (that.reasons.length === 0) {
    return self;
  }
  const newCause = new CauseImpl(union(self.reasons, that.reasons));
  return equals(self, newCause) ? self : newCause;
});
var causeMap = /* @__PURE__ */ dual(2, (self, f) => {
  let hasFail = false;
  const failures = self.reasons.map((failure) => {
    if (isFailReason(failure)) {
      hasFail = true;
      return new Fail(f(failure.error));
    }
    return failure;
  });
  return hasFail ? causeFromReasons(failures) : self;
});
var causePrettyErrors = (self) => {
  const errors = [];
  const interrupts = [];
  if (self.reasons.length === 0)
    return errors;
  const prevStackLimit = getStackTraceLimit();
  setStackTraceLimit(1);
  for (const failure of self.reasons) {
    if (failure._tag === "Interrupt") {
      interrupts.push(failure);
      continue;
    }
    errors.push(causePrettyError(failure._tag === "Die" ? failure.defect : failure.error, failure.annotations));
  }
  if (errors.length === 0) {
    const cause = new Error("The fiber was interrupted by:");
    cause.name = "InterruptCause";
    cause.stack = interruptCauseStack(cause, interrupts);
    const error = new globalThis.Error("All fibers interrupted without error", {
      cause
    });
    error.name = "InterruptError";
    error.stack = `${error.name}: ${error.message}`;
    errors.push(causePrettyError(error, interrupts[0].annotations));
  }
  setStackTraceLimit(prevStackLimit);
  return errors;
};
var causePrettyError = (original, annotations) => {
  const kind = typeof original;
  let error;
  if (original && kind === "object") {
    error = new globalThis.Error(causePrettyMessage(original), {
      cause: original.cause ? causePrettyError(original.cause) : undefined
    });
    if (typeof original.name === "string") {
      error.name = original.name;
    }
    if (typeof original.stack === "string") {
      error.stack = cleanErrorStack(original.stack, error, annotations);
    } else {
      const stack = `${error.name}: ${error.message}`;
      error.stack = annotations ? addStackAnnotations(stack, annotations) : stack;
    }
    for (const key of Object.keys(original)) {
      if (!(key in error)) {
        error[key] = original[key];
      }
    }
  } else {
    error = new globalThis.Error(!original ? `Unknown error: ${original}` : kind === "string" ? original : formatJson(original));
  }
  return error;
};
var causePrettyMessage = (u) => {
  if (typeof u.message === "string") {
    return u.message;
  } else if (typeof u.toString === "function" && u.toString !== Object.prototype.toString && u.toString !== Array.prototype.toString) {
    try {
      return u.toString();
    } catch {}
  }
  return formatJson(u);
};
var locationRegExp = /\((.*)\)/g;
var cleanErrorStack = (stack, error, annotations) => {
  const message = `${error.name}: ${error.message}`;
  const lines = (stack.startsWith(message) ? stack.slice(message.length) : stack).split(`
`);
  const out = [message];
  for (let i = 1;i < lines.length; i++) {
    if (/(?:Generator\.next|~effect\/Effect)/.test(lines[i])) {
      break;
    }
    out.push(lines[i]);
  }
  return annotations ? addStackAnnotations(out.join(`
`), annotations) : out.join(`
`);
};
var addStackAnnotations = (stack, annotations) => {
  const frame = annotations?.get(StackTraceKey.key);
  if (frame) {
    stack = `${stack}
${currentStackTrace(frame)}`;
  }
  return stack;
};
var interruptCauseStack = (error, interrupts) => {
  const out = [`${error.name}: ${error.message}`];
  for (const current of interrupts) {
    const fiberId = current.fiberId !== undefined ? `#${current.fiberId}` : "unknown";
    const frame = current.annotations.get(InterruptorStackTrace.key);
    out.push(`    at fiber (${fiberId})`);
    if (frame)
      out.push(currentStackTrace(frame));
  }
  return out.join(`
`);
};
var currentStackTrace = (frame) => {
  const out = [];
  let current = frame;
  let i = 0;
  while (current && i < 10) {
    const stack = current.stack();
    if (stack) {
      const locationMatchAll = stack.matchAll(locationRegExp);
      let match4 = false;
      for (const [, location] of locationMatchAll) {
        match4 = true;
        out.push(`    at ${current.name} (${location})`);
      }
      if (!match4) {
        out.push(`    at ${current.name} (${stack.replace(/^at /, "")})`);
      }
    } else {
      out.push(`    at ${current.name}`);
    }
    current = current.parent;
    i++;
  }
  return out.join(`
`);
};
var causePretty = (cause) => causePrettyErrors(cause).map(renderPrettyError).join(`
`);
var renderPrettyError = (e) => e.cause ? `${e.stack} {
${renderErrorCause(e.cause, "  ")}
}` : e.stack;
var renderErrorCause = (cause, prefix) => {
  const lines = cause.stack.split(`
`);
  let stack = `${prefix}[cause]: ${lines[0]}`;
  for (let i = 1, len = lines.length;i < len; i++) {
    stack += `
${prefix}${lines[i]}`;
  }
  if (cause.cause) {
    stack += ` {
${renderErrorCause(cause.cause, `${prefix}  `)}
${prefix}}`;
  }
  return stack;
};
var FiberTypeId = `~effect/Fiber/${version}`;
var fiberVariance = {
  _A: identity,
  _E: identity
};
var fiberIdStore = {
  id: 0
};
var getCurrentFiber = () => globalThis[currentFiberTypeId];

class FiberImpl {
  constructor(context, interruptible = true) {
    this[FiberTypeId] = fiberVariance;
    this.setContext(context);
    this.id = ++fiberIdStore.id;
    this.currentOpCount = 0;
    this.currentLoopCount = 0;
    this.interruptible = interruptible;
    this._stack = [];
    this._observers = [];
    this._exit = undefined;
    this._children = undefined;
    this._interruptedCause = undefined;
    this._yielded = undefined;
    this.runtimeMetrics?.recordFiberStart(this.context);
  }
  [FiberTypeId];
  id;
  interruptible;
  currentOpCount;
  currentLoopCount;
  _stack;
  _observers;
  _exit;
  _currentExit;
  _children;
  _interruptedCause;
  _yielded;
  context;
  currentScheduler;
  currentTracerContext;
  currentSpan;
  currentLogLevel;
  minimumLogLevel;
  currentStackFrame;
  runtimeMetrics;
  maxOpsBeforeYield;
  currentPreventYield;
  _dispatcher = undefined;
  get currentDispatcher() {
    return this._dispatcher ??= this.currentScheduler.makeDispatcher();
  }
  getRef(ref) {
    return getReferenceUnsafe(this.context, ref);
  }
  addObserver(cb) {
    if (this._exit) {
      cb(this._exit);
      return constVoid;
    }
    this._observers.push(cb);
    return () => {
      const index = this._observers.indexOf(cb);
      if (index >= 0) {
        this._observers.splice(index, 1);
      }
    };
  }
  interruptUnsafe(fiberId, annotations) {
    if (this._exit) {
      return;
    }
    let cause = causeInterrupt(fiberId);
    if (this.currentStackFrame) {
      cause = causeAnnotate(cause, make6(StackTraceKey, this.currentStackFrame));
    }
    if (annotations) {
      cause = causeAnnotate(cause, annotations);
    }
    this._interruptedCause = this._interruptedCause ? causeCombine(this._interruptedCause, cause) : cause;
    if (this.interruptible) {
      this.evaluate(failCause(this._interruptedCause));
    }
  }
  pollUnsafe() {
    return this._exit;
  }
  evaluate(effect) {
    if (this._exit) {
      return;
    } else if (this._yielded !== undefined) {
      const yielded = this._yielded;
      this._yielded = undefined;
      yielded();
    }
    const exit = this.runLoop(effect);
    if (exit === Yield) {
      return;
    }
    const interruptChildren = fiberMiddleware.interruptChildren && fiberMiddleware.interruptChildren(this);
    if (interruptChildren !== undefined) {
      return this.evaluate(flatMap3(interruptChildren, () => exit));
    }
    this._exit = exit;
    this.runtimeMetrics?.recordFiberEnd(this.context, this._exit);
    for (let i = 0;i < this._observers.length; i++) {
      this._observers[i](exit);
    }
    this._observers.length = 0;
  }
  runLoop(effect) {
    const prevFiber = globalThis[currentFiberTypeId];
    globalThis[currentFiberTypeId] = this;
    let yielding = false;
    let current = effect;
    this.currentOpCount = 0;
    const currentLoop = ++this.currentLoopCount;
    try {
      while (true) {
        this.currentOpCount++;
        if (!yielding && !this.currentPreventYield && this.currentScheduler.shouldYield(this)) {
          yielding = true;
          const prev = current;
          current = flatMap3(yieldNow, () => prev);
        }
        current = this.currentTracerContext ? this.currentTracerContext(current, this) : current[evaluate](this);
        if (currentLoop !== this.currentLoopCount) {
          return Yield;
        } else if (current === Yield) {
          const yielded = this._yielded;
          if (ExitTypeId in yielded) {
            this._yielded = undefined;
            return yielded;
          }
          return Yield;
        }
      }
    } catch (error) {
      if (!hasProperty(current, evaluate)) {
        return exitDie(`Fiber.runLoop: Not a valid effect: ${String(current)}`);
      }
      return this.runLoop(exitDie(error));
    } finally {
      globalThis[currentFiberTypeId] = prevFiber;
    }
  }
  getCont(symbol3) {
    while (true) {
      const op = this._stack.pop();
      if (!op)
        return;
      const cont = op[contAll] && op[contAll](this);
      if (cont) {
        cont[symbol3] = cont;
        return cont;
      }
      if (op[symbol3])
        return op;
    }
  }
  yieldWith(value) {
    this._yielded = value;
    return Yield;
  }
  children() {
    return this._children ??= new Set;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  setContext(context) {
    this.context = context;
    const scheduler = this.getRef(Scheduler);
    if (scheduler !== this.currentScheduler) {
      this.currentScheduler = scheduler;
      this._dispatcher = undefined;
    }
    this.currentSpan = context.mapUnsafe.get(ParentSpanKey);
    this.currentLogLevel = this.getRef(CurrentLogLevel);
    this.minimumLogLevel = this.getRef(MinimumLogLevel);
    this.currentStackFrame = context.mapUnsafe.get(CurrentStackFrame.key);
    this.maxOpsBeforeYield = this.getRef(MaxOpsBeforeYield);
    this.currentPreventYield = this.getRef(PreventSchedulerYield);
    this.runtimeMetrics = context.mapUnsafe.get(FiberRuntimeMetricsKey);
    const currentTracer = context.mapUnsafe.get(TracerKey);
    this.currentTracerContext = currentTracer ? currentTracer["context"] : undefined;
  }
  get currentSpanLocal() {
    return this.currentSpan?._tag === "Span" ? this.currentSpan : undefined;
  }
}
var fiberMiddleware = {
  interruptChildren: undefined
};
var fiberStackAnnotations = (fiber) => {
  if (!fiber.currentStackFrame)
    return;
  const annotations = new Map;
  annotations.set(StackTraceKey.key, fiber.currentStackFrame);
  return makeUnsafe(annotations);
};
var fiberAwaitAll = (self) => callback((resume) => {
  const iter = self[Symbol.iterator]();
  const exits = [];
  let cancel = undefined;
  function loop() {
    let result = iter.next();
    while (!result.done) {
      if (result.value._exit) {
        exits.push(result.value._exit);
        result = iter.next();
        continue;
      }
      cancel = result.value.addObserver((exit) => {
        exits.push(exit);
        loop();
      });
      return;
    }
    resume(succeed3(exits));
  }
  loop();
  return sync(() => cancel?.());
});
var fiberInterruptAll = (fibers) => withFiber((parent) => {
  const annotations = fiberStackAnnotations(parent);
  for (const fiber of fibers) {
    fiber.interruptUnsafe(parent.id, annotations);
  }
  return asVoid(fiberAwaitAll(fibers));
});
var succeed3 = exitSucceed;
var failCause = exitFailCause;
var fail3 = exitFail;
var sync = /* @__PURE__ */ makePrimitive({
  op: "Sync",
  [evaluate](fiber) {
    const value = this[args]();
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](value, fiber) : fiber.yieldWith(exitSucceed(value));
  }
});
var suspend = /* @__PURE__ */ makePrimitive({
  op: "Suspend",
  [evaluate](_fiber) {
    return this[args]();
  }
});
var fromResult = /* @__PURE__ */ match2({
  onFailure: fail3,
  onSuccess: succeed3
});
var yieldNowWith = /* @__PURE__ */ makePrimitive({
  op: "Yield",
  [evaluate](fiber) {
    let resumed = false;
    fiber.currentDispatcher.scheduleTask(() => {
      if (resumed)
        return;
      fiber.evaluate(exitVoid);
    }, this[args] ?? 0);
    return fiber.yieldWith(() => {
      resumed = true;
    });
  }
});
var yieldNow = /* @__PURE__ */ yieldNowWith(0);
var succeedSome = (a) => succeed3(some2(a));
var succeedNone = /* @__PURE__ */ succeed3(/* @__PURE__ */ none2());
var failCauseSync = (evaluate2) => suspend(() => failCause(internalCall(evaluate2)));
var die = (defect) => exitDie(defect);
var failSync = (error) => suspend(() => fail3(internalCall(error)));
var void_ = /* @__PURE__ */ succeed3(undefined);
var try_ = (options) => {
  const evaluate2 = typeof options === "function" ? options : options.try;
  const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.try") : options.catch;
  return suspend(() => {
    try {
      return succeed3(internalCall(evaluate2));
    } catch (err) {
      return fail3(internalCall(() => catcher(err)));
    }
  });
};
var tryPromise = (options) => {
  const f = typeof options === "function" ? options : options.try;
  const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.tryPromise") : options.catch;
  return callbackOptions(function(resume, signal) {
    const failWithCatch = (cause) => {
      try {
        resume(fail3(internalCall(() => catcher(cause))));
      } catch (err) {
        resume(die(err));
      }
    };
    try {
      internalCall(() => f(signal)).then((a) => resume(succeed3(a)), failWithCatch);
    } catch (err) {
      failWithCatch(err);
    }
  }, f.length !== 0);
};
var callbackOptions = /* @__PURE__ */ makePrimitive({
  op: "Async",
  single: false,
  [evaluate](fiber) {
    const register = internalCall(() => this[args][0].bind(fiber.currentScheduler));
    let resumed = false;
    let yielded = false;
    const controller = this[args][1] ? new AbortController : undefined;
    const onCancel = register((effect) => {
      if (resumed)
        return;
      resumed = true;
      if (yielded) {
        fiber.evaluate(effect);
      } else {
        yielded = effect;
      }
    }, controller?.signal);
    if (yielded !== false)
      return yielded;
    yielded = true;
    fiber._yielded = () => {
      resumed = true;
    };
    if (controller === undefined && onCancel === undefined) {
      return Yield;
    }
    fiber._stack.push(asyncFinalizer(() => {
      resumed = true;
      controller?.abort();
      return onCancel ?? exitVoid;
    }));
    return Yield;
  }
});
var asyncFinalizer = /* @__PURE__ */ makePrimitive({
  op: "AsyncFinalizer",
  [contAll](fiber) {
    if (fiber.interruptible) {
      fiber.interruptible = false;
      fiber._stack.push(setInterruptibleTrue);
    }
  },
  [contE](cause, _fiber) {
    return hasInterrupts(cause) ? flatMap3(this[args](), () => failCause(cause)) : failCause(cause);
  }
});
var callback = (register) => callbackOptions(register, register.length >= 2);
var defineFunctionLength = (length, fn) => Object.defineProperty(fn, "length", {
  value: length,
  configurable: true
});
var fnUntracedEager = (body, ...pipeables) => defineFunctionLength(body.length, pipeables.length === 0 ? function() {
  return fromIteratorEagerUnsafe(() => body.apply(this, arguments));
} : function() {
  let effect = fromIteratorEagerUnsafe(() => body.apply(this, arguments));
  for (const pipeable of pipeables) {
    effect = pipeable(effect);
  }
  return effect;
});
var fromIteratorEagerUnsafe = (evaluate2) => {
  try {
    const iterator = evaluate2();
    let value = undefined;
    while (true) {
      const state = iterator.next(value);
      if (state.done) {
        return succeed3(state.value);
      }
      const primitive = state.value;
      if (primitive && primitive._tag === "Success") {
        value = primitive.value;
        continue;
      } else if (primitive && primitive._tag === "Failure") {
        return state.value;
      } else {
        let isFirstExecution = true;
        return suspend(() => {
          if (isFirstExecution) {
            isFirstExecution = false;
            return flatMap3(state.value, (value2) => fromIteratorUnsafe(iterator, value2));
          } else {
            return suspend(() => fromIteratorUnsafe(evaluate2()));
          }
        });
      }
    }
  } catch (error) {
    return die(error);
  }
};
var fromIteratorUnsafe = /* @__PURE__ */ makePrimitive({
  op: "Iterator",
  single: false,
  [contA](value, fiber) {
    const iter = this[args][0];
    while (true) {
      const state = iter.next(value);
      if (state.done)
        return succeed3(state.value);
      if (!effectIsExit(state.value)) {
        fiber._stack.push(this);
        return state.value;
      } else if (state.value._tag === "Failure") {
        return state.value;
      }
      value = state.value.value;
    }
  },
  [evaluate](fiber) {
    return this[contA](this[args][1], fiber);
  }
});
var asVoid = (self) => flatMap3(self, (_) => exitVoid);
var flatMap3 = /* @__PURE__ */ dual(2, (self, f) => {
  const onSuccess = Object.create(OnSuccessProto);
  onSuccess[args] = self;
  onSuccess[contA] = f.length !== 1 ? (a) => f(a) : f;
  return onSuccess;
});
var OnSuccessProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccess",
  [evaluate](fiber) {
    fiber._stack.push(this);
    return this[args];
  }
});
var effectIsExit = (effect) => (ExitTypeId in effect);
var flatMapEager = /* @__PURE__ */ dual(2, (self, f) => {
  if (effectIsExit(self)) {
    return self._tag === "Success" ? f(self.value) : self;
  }
  return flatMap3(self, f);
});
var map5 = /* @__PURE__ */ dual(2, (self, f) => flatMap3(self, (a) => succeed3(internalCall(() => f(a)))));
var mapEager = /* @__PURE__ */ dual(2, (self, f) => effectIsExit(self) ? exitMap(self, f) : map5(self, f));
var mapErrorEager = /* @__PURE__ */ dual(2, (self, f) => effectIsExit(self) ? exitMapError(self, f) : mapError2(self, f));
var mapBothEager = /* @__PURE__ */ dual(2, (self, options) => effectIsExit(self) ? exitMapBoth(self, options) : mapBoth(self, options));
var catchEager = /* @__PURE__ */ dual(2, (self, f) => {
  if (effectIsExit(self)) {
    if (self._tag === "Success")
      return self;
    const error = findError(self.cause);
    if (isFailure2(error))
      return self;
    return f(error.success);
  }
  return catch_(self, f);
});
var exitIsSuccess = (self) => self._tag === "Success";
var exitIsFailure = (self) => self._tag === "Failure";
var exitVoid = /* @__PURE__ */ exitSucceed(undefined);
var exitMap = /* @__PURE__ */ dual(2, (self, f) => self._tag === "Success" ? exitSucceed(f(self.value)) : self);
var exitMapError = /* @__PURE__ */ dual(2, (self, f) => {
  if (self._tag === "Success")
    return self;
  const error = findError(self.cause);
  if (isFailure2(error))
    return self;
  return exitFail(f(error.success));
});
var exitMapBoth = /* @__PURE__ */ dual(2, (self, options) => {
  if (self._tag === "Success")
    return exitSucceed(options.onSuccess(self.value));
  const error = findError(self.cause);
  if (isFailure2(error))
    return self;
  return exitFail(options.onFailure(error.success));
});
var catchCause = /* @__PURE__ */ dual(2, (self, f) => {
  const onFailure = Object.create(OnFailureProto);
  onFailure[args] = self;
  onFailure[contE] = f.length !== 1 ? (cause) => f(cause) : f;
  return onFailure;
});
var OnFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnFailure",
  [evaluate](fiber) {
    fiber._stack.push(this);
    return this[args];
  }
});
var catchCauseFilter = /* @__PURE__ */ dual(3, (self, filter3, f) => catchCause(self, (cause) => {
  const eb = filter3(cause);
  return isFailure2(eb) ? failCause(eb.failure) : internalCall(() => f(eb.success, cause));
}));
var catch_ = /* @__PURE__ */ dual(2, (self, f) => catchCauseFilter(self, findError, (e) => f(e)));
var mapError2 = /* @__PURE__ */ dual(2, (self, f) => catch_(self, (error) => failSync(() => f(error))));
var mapBoth = /* @__PURE__ */ dual(2, (self, options) => matchEffect(self, {
  onFailure: (e) => failSync(() => options.onFailure(e)),
  onSuccess: (a) => sync(() => options.onSuccess(a))
}));
var matchCauseEffect = /* @__PURE__ */ dual(2, (self, options) => {
  const primitive = Object.create(OnSuccessAndFailureProto);
  primitive[args] = self;
  primitive[contA] = options.onSuccess.length !== 1 ? (a) => options.onSuccess(a) : options.onSuccess;
  primitive[contE] = options.onFailure.length !== 1 ? (cause) => options.onFailure(cause) : options.onFailure;
  return primitive;
});
var OnSuccessAndFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccessAndFailure",
  [evaluate](fiber) {
    fiber._stack.push(this);
    return this[args];
  }
});
var matchEffect = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
  onFailure: (cause) => {
    const fail4 = cause.reasons.find(isFailReason);
    return fail4 ? internalCall(() => options.onFailure(fail4.error)) : failCause(cause);
  },
  onSuccess: options.onSuccess
}));
var match4 = /* @__PURE__ */ dual(2, (self, options) => matchEffect(self, {
  onFailure: (error) => sync(() => options.onFailure(error)),
  onSuccess: (value) => sync(() => options.onSuccess(value))
}));
var exit = (self) => effectIsExit(self) ? exitSucceed(self) : exitPrimitive(self);
var exitPrimitive = /* @__PURE__ */ makePrimitive({
  op: "Exit",
  [evaluate](fiber) {
    fiber._stack.push(this);
    return this[args];
  },
  [contA](value, _, exit2) {
    return succeed3(exit2 ?? exitSucceed(value));
  },
  [contE](cause, _, exit2) {
    return succeed3(exit2 ?? exitFailCause(cause));
  }
});
var onExitPrimitive = /* @__PURE__ */ makePrimitive({
  op: "OnExit",
  single: false,
  [evaluate](fiber) {
    fiber._stack.push(this);
    return this[args][0];
  },
  [contAll](fiber) {
    if (fiber.interruptible && this[args][2] !== true) {
      fiber._stack.push(setInterruptibleTrue);
      fiber.interruptible = false;
    }
  },
  [contA](value, _, exit2) {
    exit2 ??= exitSucceed(value);
    const eff = this[args][1](exit2);
    return eff ? flatMap3(eff, (_2) => exit2) : exit2;
  },
  [contE](cause, _, exit2) {
    exit2 ??= exitFailCause(cause);
    const eff = this[args][1](exit2);
    return eff ? flatMap3(eff, (_2) => exit2) : exit2;
  }
});
var setInterruptible = /* @__PURE__ */ makePrimitive({
  op: "SetInterruptible",
  [contAll](fiber) {
    fiber.interruptible = this[args];
    if (fiber._interruptedCause && fiber.interruptible) {
      return () => failCause(fiber._interruptedCause);
    }
  }
});
var setInterruptibleTrue = /* @__PURE__ */ setInterruptible(true);
var whileLoop = /* @__PURE__ */ makePrimitive({
  op: "While",
  [contA](value, fiber) {
    this[args].step(value);
    if (this[args].while()) {
      fiber._stack.push(this);
      return this[args].body();
    }
    return exitVoid;
  },
  [evaluate](fiber) {
    if (this[args].while()) {
      fiber._stack.push(this);
      return this[args].body();
    }
    return exitVoid;
  }
});
var iterateEagerImpl = (options) => {
  const onItem = options.onItem;
  const step = options.step;
  return (state, items, opts) => {
    let index = opts?.start ?? 0;
    const end = opts?.end ?? items.length;
    const concurrency = opts?.concurrency ?? 1;
    let done = false;
    let parentFiber;
    let fibers;
    let resume;
    let interrupted = false;
    let terminal;
    let effect;
    const go = () => {
      let paused = false;
      for (;!terminal && index < end; index++) {
        const item = items[index];
        const eff = effect ?? onItem(state, item, index);
        if (effectIsExit(eff)) {
          terminal = step(state, item, eff, index);
          if (terminal)
            break;
        } else if (concurrency === 1) {
          return flatMap3(exit(eff), (exit2) => {
            terminal = step(state, item, exit2, index);
            index++;
            return terminal ?? go() ?? void_;
          });
        } else if (!parentFiber) {
          return callback((cb) => {
            parentFiber = getCurrentFiber();
            effect = eff;
            resume = cb;
            const result = go();
            if (result)
              return cb(result);
            return suspend(() => {
              terminal = exitVoid;
              interrupted = true;
              return fibers ? fiberInterruptAll(fibers) : void_;
            });
          });
        } else {
          effect = undefined;
          const fiber = forkUnsafe(parentFiber, eff, true, true, "inherit");
          if (fiber._exit) {
            terminal = step(state, item, fiber._exit, index);
            if (terminal)
              break;
            continue;
          }
          if (fibers)
            fibers.add(fiber);
          else
            fibers = new Set([fiber]);
          const currentIndex = index;
          fiber.addObserver((exit2) => {
            fibers.delete(fiber);
            if (terminal) {
              if (!interrupted && exit2._tag === "Failure") {
                for (const reason of exit2.cause.reasons) {
                  if (reason._tag === "Interrupt")
                    continue;
                  else if (terminal._tag === "Failure") {
                    terminal.cause.reasons.push(reason);
                  } else {
                    terminal = exitFailCause(causeFromReasons([reason]));
                  }
                }
              }
            } else {
              const result = step(state, item, exit2, currentIndex);
              if (result) {
                terminal = result._tag === "Failure" ? exitFailCause(causeFromReasons(result.cause.reasons.slice())) : result;
                go();
              }
            }
            if (paused) {
              const eff2 = go();
              if (eff2)
                resume(eff2);
            } else if (done && fibers.size === 0) {
              resume(terminal ?? void_);
            }
          });
          if (fibers.size < concurrency)
            continue;
          paused = true;
          index++;
          return;
        }
      }
      done = true;
      if (terminal) {
        if (fibers && fibers.size > 0) {
          const annotations = fiberStackAnnotations(parentFiber);
          fibers.forEach((f) => f.interruptUnsafe(parentFiber.id, annotations));
          return;
        }
        if (resume || terminal._tag === "Failure") {
          return terminal;
        }
      } else if (resume) {
        if (!fibers) {
          return exitVoid;
        } else if (fibers.size === 0) {
          resume(void_);
        }
      }
    };
    return go();
  };
};
var iterateEager = () => iterateEagerImpl;
var forkUnsafe = (parent, effect, immediate = false, daemon = false, uninterruptible = false) => {
  const interruptible = uninterruptible === "inherit" ? parent.interruptible : !uninterruptible;
  const child = new FiberImpl(parent.context, interruptible);
  if (immediate) {
    child.evaluate(effect);
  } else {
    parent.currentDispatcher.scheduleTask(() => child.evaluate(effect), 0);
  }
  if (!daemon && !child._exit) {
    parent.children().add(child);
    child.addObserver(() => parent._children.delete(child));
  }
  return child;
};
var runForkWith = (context) => (effect, options) => {
  const fiber = new FiberImpl(options?.scheduler ? add(context, Scheduler, options.scheduler) : context, options?.uninterruptible !== true);
  fiber.evaluate(effect);
  if (fiber._exit)
    return fiber;
  if (options?.signal) {
    if (options.signal.aborted) {
      fiber.interruptUnsafe();
    } else {
      const abort = () => fiber.interruptUnsafe();
      options.signal.addEventListener("abort", abort, {
        once: true
      });
      fiber.addObserver(() => options.signal.removeEventListener("abort", abort));
    }
  }
  if (options?.onFiberStart) {
    options.onFiberStart(fiber);
  }
  return fiber;
};
var runFork = /* @__PURE__ */ runForkWith(/* @__PURE__ */ empty3());
var runPromiseExitWith = (context) => {
  const runFork2 = runForkWith(context);
  return (effect, options) => {
    const fiber = runFork2(effect, options);
    return new Promise((resolve) => {
      fiber.addObserver((exit2) => resolve(exit2));
    });
  };
};
var runPromiseExit = /* @__PURE__ */ runPromiseExitWith(/* @__PURE__ */ empty3());
var runSyncExitWith = (context) => {
  const runFork2 = runForkWith(context);
  return (effect) => {
    if (effectIsExit(effect))
      return effect;
    const scheduler = new MixedScheduler("sync");
    const fiber = runFork2(effect, {
      scheduler
    });
    fiber.currentDispatcher?.flush();
    return fiber._exit ?? exitDie(new AsyncFiberError(fiber));
  };
};
var runSyncExit = /* @__PURE__ */ runSyncExitWith(/* @__PURE__ */ empty3());
var MAX_TIMER_MILLIS = 2 ** 31 - 1;
var IllegalArgumentErrorTypeId = "~effect/Cause/IllegalArgumentError";
class IllegalArgumentError extends (/* @__PURE__ */ TaggedError("IllegalArgumentError")) {
  [IllegalArgumentErrorTypeId] = IllegalArgumentErrorTypeId;
  constructor(message) {
    super({
      message
    });
  }
}
var AsyncFiberErrorTypeId = "~effect/Cause/AsyncFiberError";
class AsyncFiberError extends (/* @__PURE__ */ TaggedError("AsyncFiberError")) {
  [AsyncFiberErrorTypeId] = AsyncFiberErrorTypeId;
  constructor(fiber) {
    super({
      message: "An asynchronous Effect was executed with Effect.runSync",
      fiber
    });
  }
}
var UnknownErrorTypeId = "~effect/Cause/UnknownError";
class UnknownError extends (/* @__PURE__ */ TaggedError("UnknownError")) {
  [UnknownErrorTypeId] = UnknownErrorTypeId;
  constructor(cause, message) {
    super({
      message,
      cause
    });
  }
}
var LoggerTypeId = "~effect/Logger";
var LoggerProto = {
  [LoggerTypeId]: {
    _Message: identity,
    _Output: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var colors = {
  bold: "1",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  cyan: "36",
  white: "37",
  gray: "90",
  black: "30",
  bgBrightRed: "101"
};
var logLevelColors = {
  None: [],
  All: [],
  Trace: [colors.gray],
  Debug: [colors.blue],
  Info: [colors.green],
  Warn: [colors.yellow],
  Error: [colors.red],
  Fatal: [colors.bgBrightRed, colors.black]
};

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Cause.js
var isCause2 = isCause;
var isReason = isCauseReason;
var isFailReason2 = isFailReason;
var fromReasons = causeFromReasons;
var empty4 = causeEmpty;
var makeFailReason = (error) => new Fail(error);
var makeDieReason = (defect) => new Die(defect);
var makeInterruptReason2 = makeInterruptReason;
var map6 = causeMap;
var pretty = causePretty;
var IllegalArgumentError2 = IllegalArgumentError;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Chunk.js
var TypeId6 = "~effect/collections/Chunk";
function copy(src, srcPos, dest, destPos, len) {
  for (let i = srcPos;i < Math.min(src.length, srcPos + len); i++) {
    dest[destPos + i - srcPos] = src[i];
  }
  return dest;
}
var emptyArray = [];
var makeEquivalence3 = (isEquivalent) => make2((self, that) => self.length === that.length && toReadonlyArray(self).every((value, i) => isEquivalent(value, getUnsafe3(that, i))));
var _equivalence = /* @__PURE__ */ makeEquivalence3(equals);
var ChunkProto = {
  [TypeId6]: {
    _A: (_) => _
  },
  toString() {
    return `Chunk(${format(toReadonlyArray(this))})`;
  },
  toJSON() {
    return {
      _id: "Chunk",
      values: toJson(toReadonlyArray(this))
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  [symbol2](that) {
    return isChunk(that) && _equivalence(this, that);
  },
  [symbol]() {
    return array(toReadonlyArray(this));
  },
  [Symbol.iterator]() {
    switch (this.backing._tag) {
      case "IArray": {
        return this.backing.array[Symbol.iterator]();
      }
      case "IEmpty": {
        return emptyArray[Symbol.iterator]();
      }
      default: {
        return toReadonlyArray(this)[Symbol.iterator]();
      }
    }
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var makeChunk = (backing) => {
  const chunk = Object.create(ChunkProto);
  chunk.backing = backing;
  switch (backing._tag) {
    case "IEmpty": {
      chunk.length = 0;
      chunk.depth = 0;
      chunk.left = chunk;
      chunk.right = chunk;
      break;
    }
    case "IConcat": {
      chunk.length = backing.left.length + backing.right.length;
      chunk.depth = 1 + Math.max(backing.left.depth, backing.right.depth);
      chunk.left = backing.left;
      chunk.right = backing.right;
      break;
    }
    case "IArray": {
      chunk.length = backing.array.length;
      chunk.depth = 0;
      chunk.left = _empty;
      chunk.right = _empty;
      break;
    }
    case "ISingleton": {
      chunk.length = 1;
      chunk.depth = 0;
      chunk.left = _empty;
      chunk.right = _empty;
      break;
    }
    case "ISlice": {
      chunk.length = backing.length;
      chunk.depth = backing.chunk.depth + 1;
      chunk.left = _empty;
      chunk.right = _empty;
      break;
    }
  }
  return chunk;
};
var isChunk = (u) => hasProperty(u, TypeId6);
var _empty = /* @__PURE__ */ makeChunk({
  _tag: "IEmpty"
});
var empty5 = () => _empty;
var of = (a) => makeChunk({
  _tag: "ISingleton",
  a
});
var fromIterable2 = (self) => isChunk(self) ? self : fromArrayUnsafe(fromIterable(self));
var copyToArray = (self, array2, initial) => {
  switch (self.backing._tag) {
    case "IArray": {
      copy(self.backing.array, 0, array2, initial, self.length);
      break;
    }
    case "IConcat": {
      copyToArray(self.left, array2, initial);
      copyToArray(self.right, array2, initial + self.left.length);
      break;
    }
    case "ISingleton": {
      array2[initial] = self.backing.a;
      break;
    }
    case "ISlice": {
      let i = 0;
      let j = initial;
      while (i < self.length) {
        array2[j] = getUnsafe3(self, i);
        i += 1;
        j += 1;
      }
      break;
    }
  }
};
var toReadonlyArray_ = (self) => {
  switch (self.backing._tag) {
    case "IEmpty": {
      return emptyArray;
    }
    case "IArray": {
      return self.backing.array;
    }
    default: {
      const arr = new Array(self.length);
      copyToArray(self, arr, 0);
      self.backing = {
        _tag: "IArray",
        array: arr
      };
      self.left = _empty;
      self.right = _empty;
      self.depth = 0;
      return arr;
    }
  }
};
var toReadonlyArray = toReadonlyArray_;
var fromArrayUnsafe = (self) => self.length === 0 ? empty5() : self.length === 1 ? of(self[0]) : makeChunk({
  _tag: "IArray",
  array: self
});
var getUnsafe3 = /* @__PURE__ */ dual(2, (self, index) => {
  const i = Math.floor(index);
  switch (self.backing._tag) {
    case "IEmpty": {
      throw new Error(`Index out of bounds: ${i}`);
    }
    case "ISingleton": {
      if (index !== 0) {
        throw new Error(`Index out of bounds: ${i}`);
      }
      return self.backing.a;
    }
    case "IArray": {
      if (i >= self.length || i < 0) {
        throw new Error(`Index out of bounds: ${i}`);
      }
      return self.backing.array[i];
    }
    case "IConcat": {
      return i < self.left.length ? getUnsafe3(self.left, i) : getUnsafe3(self.right, i - self.left.length);
    }
    case "ISlice": {
      return getUnsafe3(self.backing.chunk, i + self.backing.offset);
    }
  }
});
var size = (self) => self.length;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Data.js
var Class2 = class extends Class {
  constructor(props) {
    super();
    if (props) {
      Object.assign(this, props);
    }
  }
};
var TaggedError2 = TaggedError;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Exit.js
var isExit2 = isExit;
var succeed4 = exitSucceed;
var failCause2 = exitFailCause;
var fail4 = exitFail;
var void_2 = exitVoid;
var isSuccess3 = exitIsSuccess;
var isFailure3 = exitIsFailure;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/dateTime.js
var TypeId7 = "~effect/time/DateTime";
var TimeZoneTypeId = "~effect/time/DateTime/TimeZone";
var Proto2 = {
  [TypeId7]: TypeId7,
  pipe() {
    return pipeArguments(this, arguments);
  },
  [NodeInspectSymbol]() {
    return this.toString();
  },
  toJSON() {
    return toDateUtc(this).toJSON();
  }
};
var ProtoUtc = {
  ...Proto2,
  _tag: "Utc",
  [symbol]() {
    return number(this.epochMilliseconds);
  },
  [symbol2](that) {
    return isDateTime(that) && that._tag === "Utc" && this.epochMilliseconds === that.epochMilliseconds;
  },
  toString() {
    return `DateTime.Utc(${toDateUtc(this).toJSON()})`;
  }
};
var ProtoZoned = {
  ...Proto2,
  _tag: "Zoned",
  [symbol]() {
    return combine(number(this.epochMilliseconds))(hash(this.zone));
  },
  [symbol2](that) {
    return isDateTime(that) && that._tag === "Zoned" && this.epochMilliseconds === that.epochMilliseconds && equals(this.zone, that.zone);
  },
  toString() {
    return `DateTime.Zoned(${formatIsoZoned(this)})`;
  }
};
var ProtoTimeZone = {
  [TimeZoneTypeId]: TimeZoneTypeId,
  [NodeInspectSymbol]() {
    return this.toString();
  }
};
var ProtoTimeZoneNamed = {
  ...ProtoTimeZone,
  _tag: "Named",
  [symbol]() {
    return string(`Named:${this.id}`);
  },
  [symbol2](that) {
    return isTimeZone(that) && that._tag === "Named" && this.id === that.id;
  },
  toString() {
    return `TimeZone.Named(${this.id})`;
  },
  toJSON() {
    return {
      _id: "TimeZone",
      _tag: "Named",
      id: this.id
    };
  }
};
var ProtoTimeZoneOffset = {
  ...ProtoTimeZone,
  _tag: "Offset",
  [symbol]() {
    return string(`Offset:${this.offset}`);
  },
  [symbol2](that) {
    return isTimeZone(that) && that._tag === "Offset" && this.offset === that.offset;
  },
  toString() {
    return `TimeZone.Offset(${offsetToString(this.offset)})`;
  },
  toJSON() {
    return {
      _id: "TimeZone",
      _tag: "Offset",
      offset: this.offset
    };
  }
};
var makeZonedProto = (epochMillis, zone, partsUtc) => {
  const self = Object.create(ProtoZoned);
  self.epochMilliseconds = epochMillis;
  self.zone = zone;
  Object.defineProperty(self, "partsUtc", {
    value: partsUtc,
    enumerable: false,
    writable: true
  });
  Object.defineProperty(self, "adjustedEpochMillis", {
    value: undefined,
    enumerable: false,
    writable: true
  });
  Object.defineProperty(self, "partsAdjusted", {
    value: undefined,
    enumerable: false,
    writable: true
  });
  return self;
};
var isDateTime = (u) => hasProperty(u, TypeId7);
var isTimeZone = (u) => hasProperty(u, TimeZoneTypeId);
var isTimeZoneOffset = (u) => isTimeZone(u) && u._tag === "Offset";
var isTimeZoneNamed = (u) => isTimeZone(u) && u._tag === "Named";
var isUtc = (self) => self._tag === "Utc";
var isZoned = (self) => self._tag === "Zoned";
var Equivalence3 = /* @__PURE__ */ make2((a, b) => a.epochMilliseconds === b.epochMilliseconds);
var Order2 = /* @__PURE__ */ make4((self, that) => self.epochMilliseconds < that.epochMilliseconds ? -1 : self.epochMilliseconds > that.epochMilliseconds ? 1 : 0);
var makeUtc = (epochMillis) => {
  const self = Object.create(ProtoUtc);
  self.epochMilliseconds = epochMillis;
  Object.defineProperty(self, "partsUtc", {
    value: undefined,
    enumerable: false,
    writable: true
  });
  return self;
};
var fromDateUnsafe = (date) => {
  const epochMillis = date.getTime();
  if (Number.isNaN(epochMillis)) {
    throw new IllegalArgumentError2("Invalid date");
  }
  return makeUtc(epochMillis);
};
var makeUnsafe2 = (input) => {
  if (isDateTime(input)) {
    return input;
  } else if (input instanceof Date) {
    return fromDateUnsafe(input);
  } else if (typeof input === "object") {
    if ("epochMilliseconds" in input) {
      return makeUtc(input.epochMilliseconds);
    }
    const date = new Date(0);
    setPartsDate(date, input);
    return fromDateUnsafe(date);
  } else if (typeof input === "string" && !hasZone(input)) {
    return fromDateUnsafe(new Date(input + "Z"));
  }
  return fromDateUnsafe(new Date(input));
};
var hasZone = (input) => /Z|GMT|[+-]\d{2}$|[+-]\d{2}:?\d{2}$|\]$/.test(input);
var minEpochMillis = -8640000000000000 + 12 * 60 * 60 * 1000;
var maxEpochMillis = 8640000000000000 - 14 * 60 * 60 * 1000;
var makeZonedUnsafe = (input, options) => {
  let timeZoneOption = options?.timeZone;
  if (timeZoneOption === undefined && isDateTime(input) && isZoned(input)) {
    return input;
  }
  const self = makeUnsafe2(input);
  if (self.epochMilliseconds < minEpochMillis || self.epochMilliseconds > maxEpochMillis) {
    throw new RangeError(`Epoch millis out of range: ${self.epochMilliseconds}`);
  }
  if (timeZoneOption === undefined && typeof input === "object" && "timeZoneId" in input) {
    timeZoneOption = input.timeZoneId;
  }
  let zone;
  if (timeZoneOption === undefined) {
    const offset = new Date(self.epochMilliseconds).getTimezoneOffset() * -60 * 1000;
    zone = zoneMakeOffset(offset);
  } else if (isTimeZone(timeZoneOption)) {
    zone = timeZoneOption;
  } else if (typeof timeZoneOption === "number") {
    zone = zoneMakeOffset(timeZoneOption);
  } else {
    const parsedZone = zoneFromString(timeZoneOption);
    if (isNone2(parsedZone)) {
      throw new IllegalArgumentError2(`Invalid time zone: ${timeZoneOption}`);
    }
    zone = parsedZone.value;
  }
  if (options?.adjustForTimeZone !== true) {
    return makeZonedProto(self.epochMilliseconds, zone, self.partsUtc);
  }
  return makeZonedFromAdjusted(self.epochMilliseconds, zone, options?.disambiguation ?? "compatible");
};
var makeZoned = /* @__PURE__ */ liftThrowable(makeZonedUnsafe);
var make8 = /* @__PURE__ */ liftThrowable(makeUnsafe2);
var zonedStringRegExp = /^(.{17,35})\[(.+)\]$/;
var makeZonedFromString = (input) => {
  const match5 = zonedStringRegExp.exec(input);
  if (match5 === null) {
    const offset = parseOffset(input);
    return offset !== null ? makeZoned(input, {
      timeZone: offset
    }) : none2();
  }
  const [, isoString, timeZone] = match5;
  return makeZoned(isoString, {
    timeZone
  });
};
var toUtc = (self) => makeUtc(self.epochMilliseconds);
var validZoneCache = /* @__PURE__ */ new Map;
var formatOptions = {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  timeZoneName: "longOffset",
  fractionalSecondDigits: 3,
  hourCycle: "h23"
};
var zoneMakeIntl = (format3) => {
  const zoneId = format3.resolvedOptions().timeZone;
  if (validZoneCache.has(zoneId)) {
    return validZoneCache.get(zoneId);
  }
  const zone = Object.create(ProtoTimeZoneNamed);
  zone.id = zoneId;
  zone.format = format3;
  validZoneCache.set(zoneId, zone);
  return zone;
};
var zoneMakeNamedUnsafe = (zoneId) => {
  if (validZoneCache.has(zoneId)) {
    return validZoneCache.get(zoneId);
  }
  try {
    return zoneMakeIntl(new Intl.DateTimeFormat("en-US", {
      ...formatOptions,
      timeZone: zoneId
    }));
  } catch {
    throw new IllegalArgumentError2(`Invalid time zone: ${zoneId}`);
  }
};
var zoneMakeOffset = (offset) => {
  const zone = Object.create(ProtoTimeZoneOffset);
  zone.offset = offset;
  return zone;
};
var zoneMakeNamed = /* @__PURE__ */ liftThrowable(zoneMakeNamedUnsafe);
var offsetZoneRegExp = /^(?:GMT|[+-])/;
var zoneFromString = (zone) => {
  if (offsetZoneRegExp.test(zone)) {
    const offset = parseOffset(zone);
    return offset === null ? none2() : some2(zoneMakeOffset(offset));
  }
  return zoneMakeNamed(zone);
};
var zoneToString = (self) => {
  if (self._tag === "Offset") {
    return offsetToString(self.offset);
  }
  return self.id;
};
var toDateUtc = (self) => new Date(self.epochMilliseconds);
var toDate = (self) => {
  if (self._tag === "Utc") {
    return new Date(self.epochMilliseconds);
  } else if (self.zone._tag === "Offset") {
    return new Date(self.epochMilliseconds + self.zone.offset);
  } else if (self.adjustedEpochMilliseconds !== undefined) {
    return new Date(self.adjustedEpochMilliseconds);
  }
  const parts = self.zone.format.formatToParts(self.epochMilliseconds).filter((_) => _.type !== "literal");
  const date = new Date(0);
  date.setUTCFullYear(Number(parts[2].value), Number(parts[0].value) - 1, Number(parts[1].value));
  date.setUTCHours(Number(parts[3].value), Number(parts[4].value), Number(parts[5].value), Number(parts[6].value));
  self.adjustedEpochMilliseconds = date.getTime();
  return date;
};
var zonedOffset = (self) => {
  const date = toDate(self);
  return date.getTime() - toEpochMillis(self);
};
var offsetToString = (offset) => {
  const abs2 = Math.abs(offset);
  let hours2 = Math.floor(abs2 / (60 * 60 * 1000));
  let minutes2 = Math.round(abs2 % (60 * 60 * 1000) / (60 * 1000));
  if (minutes2 === 60) {
    hours2 += 1;
    minutes2 = 0;
  }
  return `${offset < 0 ? "-" : "+"}${String(hours2).padStart(2, "0")}:${String(minutes2).padStart(2, "0")}`;
};
var zonedOffsetIso = (self) => offsetToString(zonedOffset(self));
var toEpochMillis = (self) => self.epochMilliseconds;
var setPartsDate = (date, parts) => {
  if (parts.year !== undefined) {
    date.setUTCFullYear(parts.year);
  }
  if (parts.month !== undefined) {
    date.setUTCMonth(parts.month - 1);
  }
  if (parts.day !== undefined) {
    date.setUTCDate(parts.day);
  }
  if (parts.weekDay !== undefined) {
    const diff = parts.weekDay - date.getUTCDay();
    date.setUTCDate(date.getUTCDate() + diff);
  }
  if (parts.hour !== undefined) {
    date.setUTCHours(parts.hour);
  }
  if (parts.minute !== undefined) {
    date.setUTCMinutes(parts.minute);
  }
  if (parts.second !== undefined) {
    date.setUTCSeconds(parts.second);
  }
  if (parts.millisecond !== undefined) {
    date.setUTCMilliseconds(parts.millisecond);
  }
};
var constDayMillis = 24 * 60 * 60 * 1000;
var makeZonedFromAdjusted = (adjustedMillis, zone, disambiguation) => {
  if (zone._tag === "Offset") {
    return makeZonedProto(adjustedMillis - zone.offset, zone);
  }
  const beforeOffset = calculateNamedOffset(adjustedMillis - constDayMillis, adjustedMillis, zone);
  const afterOffset = calculateNamedOffset(adjustedMillis + constDayMillis, adjustedMillis, zone);
  if (beforeOffset === afterOffset) {
    return makeZonedProto(adjustedMillis - beforeOffset, zone);
  }
  const isForwards = beforeOffset < afterOffset;
  const transitionMillis = beforeOffset - afterOffset;
  if (isForwards) {
    const currentAfterOffset = calculateNamedOffset(adjustedMillis - afterOffset, adjustedMillis, zone);
    if (currentAfterOffset === afterOffset) {
      return makeZonedProto(adjustedMillis - afterOffset, zone);
    }
    const before = makeZonedProto(adjustedMillis - beforeOffset, zone);
    const beforeAdjustedMillis = toDate(before).getTime();
    if (adjustedMillis !== beforeAdjustedMillis) {
      switch (disambiguation) {
        case "reject": {
          const formatted = new Date(adjustedMillis).toISOString();
          throw new RangeError(`Gap time: ${formatted} does not exist in time zone ${zone.id}`);
        }
        case "earlier":
          return makeZonedProto(adjustedMillis - afterOffset, zone);
        case "compatible":
        case "later":
          return before;
      }
    }
    return before;
  }
  const currentBeforeOffset = calculateNamedOffset(adjustedMillis - beforeOffset, adjustedMillis, zone);
  if (currentBeforeOffset === beforeOffset) {
    if (disambiguation === "earlier" || disambiguation === "compatible") {
      return makeZonedProto(adjustedMillis - beforeOffset, zone);
    }
    const laterOffset = calculateNamedOffset(adjustedMillis - beforeOffset + transitionMillis, adjustedMillis + transitionMillis, zone);
    if (laterOffset === beforeOffset) {
      return makeZonedProto(adjustedMillis - beforeOffset, zone);
    }
    if (disambiguation === "reject") {
      const formatted = new Date(adjustedMillis).toISOString();
      throw new RangeError(`Ambiguous time: ${formatted} occurs twice in time zone ${zone.id}`);
    }
  }
  return makeZonedProto(adjustedMillis - afterOffset, zone);
};
var offsetRegExp = /([+-])(\d{2}):(\d{2})$/;
var parseOffset = (offset) => {
  const match5 = offsetRegExp.exec(offset);
  if (match5 === null) {
    return null;
  }
  const [, sign2, hours2, minutes2] = match5;
  return (sign2 === "+" ? 1 : -1) * (Number(hours2) * 60 + Number(minutes2)) * 60 * 1000;
};
var calculateNamedOffset = (utcMillis, adjustedMillis, zone) => {
  const offset = zone.format.formatToParts(utcMillis).find((_) => _.type === "timeZoneName")?.value ?? "";
  if (offset === "GMT") {
    return 0;
  }
  const result = parseOffset(offset);
  if (result === null) {
    return zonedOffset(makeZonedProto(adjustedMillis, zone));
  }
  return result;
};
var formatIso = (self) => toDateUtc(self).toISOString();
var formatIsoOffset = (self) => {
  const date = toDate(self);
  return self._tag === "Utc" ? date.toISOString() : `${date.toISOString().slice(0, -1)}${zonedOffsetIso(self)}`;
};
var formatIsoZoned = (self) => self.zone._tag === "Offset" ? formatIsoOffset(self) : `${formatIsoOffset(self)}[${self.zone.id}]`;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Number.js
var Number3 = globalThis.Number;
var remainder = /* @__PURE__ */ dual(2, (self, divisor) => {
  const selfDecCount = decimalCount(self);
  const divisorDecCount = decimalCount(divisor);
  const decCount = selfDecCount > divisorDecCount ? selfDecCount : divisorDecCount;
  const selfInt = parseInt(self.toFixed(decCount).replace(".", ""));
  const divisorInt = parseInt(divisor.toFixed(decCount).replace(".", ""));
  return selfInt % divisorInt / Math.pow(10, decCount);
});
function decimalCount(n) {
  const s = n.toString();
  const eIndex = s.indexOf("e-");
  if (eIndex !== -1) {
    const exp = parseInt(s.slice(eIndex + 2));
    const mantissaDecimals = (s.slice(0, eIndex).split(".")[1] || "").length;
    return mantissaDecimals + exp;
  }
  return (s.split(".")[1] || "").length;
}
var ReducerMax = /* @__PURE__ */ make((a, b) => Math.max(a, b), -Infinity);
var ReducerMin = /* @__PURE__ */ make((a, b) => Math.min(a, b), Infinity);

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/String.js
var String2 = globalThis.String;
var trim = (self) => self.trim();

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Effect.js
var tryPromise2 = tryPromise;
var succeed5 = succeed3;
var succeedNone2 = succeedNone;
var succeedSome2 = succeedSome;
var void_3 = void_;
var fail5 = fail3;
var failCauseSync2 = failCauseSync;
var try_2 = try_;
var fromResult2 = fromResult;
var flatMap4 = flatMap3;
var exit2 = exit;
var map7 = map5;
var catchCause2 = catchCause;
var match5 = match4;
var runFork2 = runFork;
var runPromiseExit2 = runPromiseExit;
var runSyncExit2 = runSyncExit;
var mapEager2 = mapEager;
var mapErrorEager2 = mapErrorEager;
var mapBothEager2 = mapBothEager;
var flatMapEager2 = flatMapEager;
var catchEager2 = catchEager;
var fnUntracedEager2 = fnUntracedEager;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/DateTime.js
var isDateTime2 = isDateTime;
var isTimeZone2 = isTimeZone;
var isTimeZoneOffset2 = isTimeZoneOffset;
var isTimeZoneNamed2 = isTimeZoneNamed;
var isUtc2 = isUtc;
var isZoned2 = isZoned;
var Equivalence4 = Equivalence3;
var Order3 = Order2;
var fromDateUnsafe2 = fromDateUnsafe;
var makeZonedUnsafe2 = makeZonedUnsafe;
var make9 = make8;
var makeZonedFromString2 = makeZonedFromString;
var toUtc2 = toUtc;
var zoneMakeNamedUnsafe2 = zoneMakeNamedUnsafe;
var zoneMakeOffset2 = zoneMakeOffset;
var zoneMakeNamed2 = zoneMakeNamed;
var zoneFromString2 = zoneFromString;
var zoneToString2 = zoneToString;
var toDateUtc2 = toDateUtc;
var toEpochMillis2 = toEpochMillis;
var formatIso2 = formatIso;
var formatIsoZoned2 = formatIsoZoned;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Encoding.js
var EncodingErrorTypeId = "~effect/encoding/EncodingError";

class EncodingError extends (/* @__PURE__ */ TaggedError2("EncodingError")) {
  [EncodingErrorTypeId] = EncodingErrorTypeId;
}
var encodeBase64 = (input) => typeof input === "string" ? base64EncodeUint8Array(encoder.encode(input)) : base64EncodeUint8Array(input);
var decodeBase64 = (str) => {
  const stripped = stripCrlf(str);
  const length = stripped.length;
  if (length % 4 !== 0) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: `Length must be a multiple of 4, but is ${length}`
    }));
  }
  const index = stripped.indexOf("=");
  if (index !== -1 && (index < length - 2 || index === length - 2 && stripped[length - 1] !== "=")) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: `Found a '=' character, but it is not at the end`
    }));
  }
  try {
    const missingOctets = stripped.endsWith("==") ? 2 : stripped.endsWith("=") ? 1 : 0;
    const result2 = new Uint8Array(3 * (length / 4) - missingOctets);
    for (let i = 0, j = 0;i < length; i += 4, j += 3) {
      const buffer = getBase64Code(stripped.charCodeAt(i)) << 18 | getBase64Code(stripped.charCodeAt(i + 1)) << 12 | getBase64Code(stripped.charCodeAt(i + 2)) << 6 | getBase64Code(stripped.charCodeAt(i + 3));
      result2[j] = buffer >> 16;
      result2[j + 1] = buffer >> 8 & 255;
      result2[j + 2] = buffer & 255;
    }
    return succeed2(result2);
  } catch (e) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: e instanceof Error ? e.message : "Invalid input"
    }));
  }
};
var decodeBase64String = (str) => map2(decodeBase64(str), (_) => decoder.decode(_));
var encodeBase64Url = (input) => typeof input === "string" ? base64UrlEncodeUint8Array(encoder.encode(input)) : base64UrlEncodeUint8Array(input);
var decodeBase64Url = (str) => {
  const stripped = stripCrlf(str);
  const length = stripped.length;
  if (length % 4 === 1) {
    return fail2(new EncodingError({
      module: "Base64Url",
      kind: "Decode",
      input: stripped,
      message: `Length should be a multiple of 4, but is ${length}`
    }));
  }
  if (!/^[-_A-Z0-9]*?={0,2}$/i.test(stripped)) {
    return fail2(new EncodingError({
      module: "Base64Url",
      kind: "Decode",
      input: stripped,
      message: "Invalid input"
    }));
  }
  let sanitized = length % 4 === 2 ? `${stripped}==` : length % 4 === 3 ? `${stripped}=` : stripped;
  sanitized = sanitized.replace(/-/g, "+").replace(/_/g, "/");
  return decodeBase64(sanitized);
};
var decodeBase64UrlString = (str) => map2(decodeBase64Url(str), (_) => decoder.decode(_));
var encodeHex = (input) => typeof input === "string" ? hexEncodeUint8Array(encoder.encode(input)) : hexEncodeUint8Array(input);
var decodeHex = (str) => {
  const bytes = new TextEncoder().encode(str);
  if (bytes.length % 2 !== 0) {
    return fail2(new EncodingError({
      module: "Hex",
      kind: "Decode",
      input: str,
      message: `Length must be a multiple of 2, but is ${bytes.length}`
    }));
  }
  try {
    const length = bytes.length / 2;
    const result2 = new Uint8Array(length);
    for (let i = 0;i < length; i++) {
      const a = fromHexChar(bytes[i * 2]);
      const b = fromHexChar(bytes[i * 2 + 1]);
      result2[i] = a << 4 | b;
    }
    return succeed2(result2);
  } catch (e) {
    return fail2(new EncodingError({
      module: "Hex",
      kind: "Decode",
      input: str,
      message: e instanceof Error ? e.message : "Invalid input"
    }));
  }
};
var decodeHexString = (str) => map2(decodeHex(str), (_) => decoder.decode(_));
var encoder = /* @__PURE__ */ new TextEncoder;
var decoder = /* @__PURE__ */ new TextDecoder;
var stripCrlf = (str) => str.replace(/[\n\r]/g, "");
var base64EncodeUint8Array = (bytes) => {
  const length = bytes.length;
  let result2 = "";
  let i;
  for (i = 2;i < length; i += 3) {
    result2 += base64abc[bytes[i - 2] >> 2];
    result2 += base64abc[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result2 += base64abc[(bytes[i - 1] & 15) << 2 | bytes[i] >> 6];
    result2 += base64abc[bytes[i] & 63];
  }
  if (i === length + 1) {
    result2 += base64abc[bytes[i - 2] >> 2];
    result2 += base64abc[(bytes[i - 2] & 3) << 4];
    result2 += "==";
  }
  if (i === length) {
    result2 += base64abc[bytes[i - 2] >> 2];
    result2 += base64abc[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result2 += base64abc[(bytes[i - 1] & 15) << 2];
    result2 += "=";
  }
  return result2;
};
function getBase64Code(charCode) {
  if (charCode >= base64codes.length) {
    throw new TypeError(`Invalid character ${String.fromCharCode(charCode)}`);
  }
  const code = base64codes[charCode];
  if (code === 255) {
    throw new TypeError(`Invalid character ${String.fromCharCode(charCode)}`);
  }
  return code;
}
var base64abc = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "/"];
var base64codes = [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 62, 255, 255, 255, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 255, 255, 255, 0, 255, 255, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 255, 255, 255, 255, 255, 255, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51];
var base64UrlEncodeUint8Array = (data) => base64EncodeUint8Array(data).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
var hexEncodeUint8Array = (bytes) => {
  let result2 = "";
  for (let i = 0;i < bytes.length; ++i) {
    result2 += bytesToHex[bytes[i]];
  }
  return result2;
};
var fromHexChar = (byte) => {
  if (48 <= byte && byte <= 57) {
    return byte - 48;
  }
  if (97 <= byte && byte <= 102) {
    return byte - 97 + 10;
  }
  if (65 <= byte && byte <= 70) {
    return byte - 65 + 10;
  }
  throw new TypeError("Invalid input");
};
var bytesToHex = ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "0a", "0b", "0c", "0d", "0e", "0f", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "1a", "1b", "1c", "1d", "1e", "1f", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "2a", "2b", "2c", "2d", "2e", "2f", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "3a", "3b", "3c", "3d", "3e", "3f", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "4a", "4b", "4c", "4d", "4e", "4f", "50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "5a", "5b", "5c", "5d", "5e", "5f", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69", "6a", "6b", "6c", "6d", "6e", "6f", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "7a", "7b", "7c", "7d", "7e", "7f", "80", "81", "82", "83", "84", "85", "86", "87", "88", "89", "8a", "8b", "8c", "8d", "8e", "8f", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99", "9a", "9b", "9c", "9d", "9e", "9f", "a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "aa", "ab", "ac", "ad", "ae", "af", "b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "ba", "bb", "bc", "bd", "be", "bf", "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "ca", "cb", "cc", "cd", "ce", "cf", "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "da", "db", "dc", "dd", "de", "df", "e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "ea", "eb", "ec", "ed", "ee", "ef", "f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "fa", "fb", "fc", "fd", "fe", "ff"];

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/hashMap.js
var HashMapTypeId = "~effect/collections/HashMap";
var SHIFT = 5;
var BUCKET_SIZE = 1 << SHIFT;
var MIN_ARRAY_NODE = BUCKET_SIZE / 4;
var MAX_INDEX_NODE = BUCKET_SIZE / 2;
var BITMAP_INDEX_MASK = BUCKET_SIZE - 1;
var popcount = (n) => {
  n = n - (n >>> 1 & 1431655765);
  n = (n & 858993459) + (n >>> 2 & 858993459);
  return (n + (n >>> 4) & 252645135) * 16843009 >>> 24;
};
var mask = (hash2, shift) => hash2 >>> shift & BITMAP_INDEX_MASK;
var bitpos = (hash2, shift) => 1 << mask(hash2, shift);
var index = (bitmap, bit) => popcount(bitmap & bit - 1);
function mergeLeaves(edit, shift, hash1, node1, hash2, node2) {
  if (shift > 32) {
    throw new Error("HashMap: max depth exceeded");
  }
  const bit1 = bitpos(hash1, shift);
  const bit2 = bitpos(hash2, shift);
  if (bit1 === bit2) {
    const child = mergeLeaves(edit, shift + SHIFT, hash1, node1, hash2, node2);
    return new IndexedNode(edit, bit1, [child]);
  }
  const bitmap = bit1 | bit2;
  const children = bit1 >>> 0 < bit2 >>> 0 ? [node1, node2] : [node2, node1];
  return new IndexedNode(edit, bitmap, children);
}

class Node {
  canEdit(edit) {
    return this.edit === edit;
  }
}

class EmptyNode extends Node {
  _tag = "EmptyNode";
  edit = 0;
  get size() {
    return 0;
  }
  get(_shift, _hash, _key) {
    return none2();
  }
  has(_shift, _hash, _key) {
    return false;
  }
  set(edit, _shift, hash2, key, value, added) {
    added.value = true;
    return new LeafNode(edit, hash2, key, value);
  }
  remove(_edit, _shift, _hash, _key, _removed) {
    return this;
  }
  iterator() {
    return [][Symbol.iterator]();
  }
  [Symbol.iterator]() {
    return this.iterator();
  }
  canEdit(_edit) {
    return false;
  }
}

class LeafNode extends Node {
  _tag = "LeafNode";
  edit;
  hash;
  key;
  value;
  constructor(edit, hash2, key, value) {
    super();
    this.edit = edit;
    this.hash = hash2;
    this.key = key;
    this.value = value;
  }
  get size() {
    return 1;
  }
  get(_shift, hash2, key) {
    if (this.hash === hash2 && equals(this.key, key)) {
      return some2(this.value);
    }
    return none2();
  }
  has(_shift, hash2, key) {
    return this.hash === hash2 && equals(this.key, key);
  }
  set(edit, shift, hash2, key, value, added) {
    if (this.hash === hash2 && equals(this.key, key)) {
      if (equals(this.value, value)) {
        return this;
      }
      if (this.canEdit(edit)) {
        this.value = value;
        return this;
      }
      return new LeafNode(edit, hash2, key, value);
    }
    added.value = true;
    if (this.hash === hash2) {
      return new CollisionNode(edit, hash2, [[this.key, this.value], [key, value]]);
    }
    const newBit = bitpos(hash2, shift);
    const existingBit = bitpos(this.hash, shift);
    if (newBit === existingBit) {
      return new IndexedNode(edit, newBit, [this.set(edit, shift + SHIFT, hash2, key, value, added)]);
    }
    const bitmap = newBit | existingBit;
    const nodes = newBit >>> 0 < existingBit >>> 0 ? [new LeafNode(edit, hash2, key, value), this] : [this, new LeafNode(edit, hash2, key, value)];
    return new IndexedNode(edit, bitmap, nodes);
  }
  remove(_edit, _shift, hash2, key, removed) {
    if (this.hash === hash2 && equals(this.key, key)) {
      removed.value = true;
      return;
    }
    return this;
  }
  iterator() {
    return [[this.key, this.value]][Symbol.iterator]();
  }
  [Symbol.iterator]() {
    return this.iterator();
  }
}

class CollisionNode extends Node {
  _tag = "CollisionNode";
  edit;
  hash;
  entries;
  constructor(edit, hash2, entries) {
    super();
    this.edit = edit;
    this.hash = hash2;
    this.entries = entries;
  }
  get size() {
    return this.entries.length;
  }
  get(_shift, hash2, key) {
    if (this.hash !== hash2) {
      return none2();
    }
    for (const [k, v] of this.entries) {
      if (equals(k, key)) {
        return some2(v);
      }
    }
    return none2();
  }
  has(_shift, hash2, key) {
    if (this.hash !== hash2) {
      return false;
    }
    for (const [k] of this.entries) {
      if (equals(k, key)) {
        return true;
      }
    }
    return false;
  }
  set(edit, shift, hash2, key, value, added) {
    if (this.hash !== hash2) {
      added.value = true;
      return mergeLeaves(edit, shift, this.hash, this, hash2, new LeafNode(edit, hash2, key, value));
    }
    for (let i = 0;i < this.entries.length; i++) {
      if (equals(this.entries[i][0], key)) {
        if (equals(this.entries[i][1], value)) {
          return this;
        }
        if (this.canEdit(edit)) {
          this.entries[i] = [key, value];
          return this;
        }
        const newEntries = [...this.entries];
        newEntries[i] = [key, value];
        return new CollisionNode(edit, this.hash, newEntries);
      }
    }
    added.value = true;
    if (this.canEdit(edit)) {
      this.entries.push([key, value]);
      return this;
    }
    return new CollisionNode(edit, this.hash, [...this.entries, [key, value]]);
  }
  remove(edit, _shift, hash2, key, removed) {
    if (this.hash !== hash2) {
      return this;
    }
    const idx = this.entries.findIndex(([k]) => equals(k, key));
    if (idx === -1) {
      return this;
    }
    removed.value = true;
    if (this.entries.length === 1) {
      return;
    }
    if (this.entries.length === 2) {
      const remaining = this.entries[idx === 0 ? 1 : 0];
      return new LeafNode(edit, this.hash, remaining[0], remaining[1]);
    }
    if (this.canEdit(edit)) {
      this.entries.splice(idx, 1);
      return this;
    }
    const newEntries = [...this.entries];
    newEntries.splice(idx, 1);
    return new CollisionNode(edit, this.hash, newEntries);
  }
  iterator() {
    return this.entries[Symbol.iterator]();
  }
  [Symbol.iterator]() {
    return this.iterator();
  }
}

class IndexedNode extends Node {
  _tag = "IndexedNode";
  edit;
  _size;
  bitmap;
  children;
  constructor(edit, bitmap, children) {
    super();
    this.edit = edit;
    this.bitmap = bitmap;
    this.children = children;
  }
  get size() {
    if (this._size === undefined) {
      this._size = this.children.reduce((acc, child) => acc + child.size, 0);
    }
    return this._size;
  }
  get(shift, hash2, key) {
    const bit = bitpos(hash2, shift);
    if ((this.bitmap & bit) === 0) {
      return none2();
    }
    const idx = index(this.bitmap, bit);
    return this.children[idx].get(shift + SHIFT, hash2, key);
  }
  has(shift, hash2, key) {
    const bit = bitpos(hash2, shift);
    if ((this.bitmap & bit) === 0) {
      return false;
    }
    const idx = index(this.bitmap, bit);
    return this.children[idx].has(shift + SHIFT, hash2, key);
  }
  set(edit, shift, hash2, key, value, added) {
    const bit = bitpos(hash2, shift);
    const idx = index(this.bitmap, bit);
    if ((this.bitmap & bit) !== 0) {
      const child = this.children[idx];
      const newChild = child.set(edit, shift + SHIFT, hash2, key, value, added);
      if (child === newChild) {
        return this;
      }
      if (this.canEdit(edit)) {
        this.children[idx] = newChild;
        return this;
      }
      const newChildren = [...this.children];
      newChildren[idx] = newChild;
      return new IndexedNode(edit, this.bitmap, newChildren);
    } else {
      added.value = true;
      const newChild = new LeafNode(edit, hash2, key, value);
      const newBitmap = this.bitmap | bit;
      if (this.canEdit(edit)) {
        this.children.splice(idx, 0, newChild);
        this.bitmap = newBitmap;
        this._size = undefined;
        if (this.children.length > MAX_INDEX_NODE) {
          return this.expand(edit, newBitmap, this.children);
        }
        return this;
      }
      const newChildren = [...this.children];
      newChildren.splice(idx, 0, newChild);
      if (newChildren.length > MAX_INDEX_NODE) {
        return this.expand(edit, newBitmap, newChildren);
      }
      return new IndexedNode(edit, newBitmap, newChildren);
    }
  }
  remove(edit, shift, hash2, key, removed) {
    const bit = bitpos(hash2, shift);
    if ((this.bitmap & bit) === 0) {
      return this;
    }
    const idx = index(this.bitmap, bit);
    const child = this.children[idx];
    const newChild = child.remove(edit, shift + SHIFT, hash2, key, removed);
    if (!removed.value) {
      return this;
    }
    if (newChild === undefined) {
      const newBitmap = this.bitmap ^ bit;
      if (newBitmap === 0) {
        return;
      }
      if (this.children.length === 2) {
        const remaining = this.children[idx === 0 ? 1 : 0];
        if (remaining._tag === "LeafNode") {
          return remaining;
        }
      }
      if (this.canEdit(edit)) {
        this.children.splice(idx, 1);
        this.bitmap = newBitmap;
        this._size = undefined;
        return this;
      }
      const newChildren2 = [...this.children];
      newChildren2.splice(idx, 1);
      return new IndexedNode(edit, newBitmap, newChildren2);
    }
    if (child === newChild) {
      return this;
    }
    if (this.canEdit(edit)) {
      this.children[idx] = newChild;
      return this;
    }
    const newChildren = [...this.children];
    newChildren[idx] = newChild;
    return new IndexedNode(edit, this.bitmap, newChildren);
  }
  expand(edit, bitmap, children) {
    const nodes = new globalThis.Array(BUCKET_SIZE);
    let j = 0;
    for (let i = 0;i < BUCKET_SIZE; i++) {
      if ((bitmap & 1 << i) !== 0) {
        nodes[i] = children[j++];
      }
    }
    return new ArrayNode(edit, children.length, nodes);
  }
  iterator() {
    let childIndex = 0;
    let currentIterator;
    return {
      next: () => {
        while (childIndex < this.children.length) {
          if (!currentIterator) {
            currentIterator = this.children[childIndex].iterator();
          }
          const result2 = currentIterator.next();
          if (!result2.done) {
            return result2;
          }
          currentIterator = undefined;
          childIndex++;
        }
        return {
          done: true,
          value: undefined
        };
      }
    };
  }
  [Symbol.iterator]() {
    return this.iterator();
  }
}

class ArrayNode extends Node {
  _tag = "ArrayNode";
  edit;
  _size;
  count;
  children;
  constructor(edit, count, children) {
    super();
    this.edit = edit;
    this.count = count;
    this.children = children;
  }
  get size() {
    if (this._size === undefined) {
      this._size = this.children.reduce((acc, child) => acc + (child?.size ?? 0), 0);
    }
    return this._size;
  }
  get(shift, hash2, key) {
    const idx = mask(hash2, shift);
    const child = this.children[idx];
    return child ? child.get(shift + SHIFT, hash2, key) : none2();
  }
  has(shift, hash2, key) {
    const idx = mask(hash2, shift);
    const child = this.children[idx];
    return child ? child.has(shift + SHIFT, hash2, key) : false;
  }
  set(edit, shift, hash2, key, value, added) {
    const idx = mask(hash2, shift);
    const child = this.children[idx];
    if (child) {
      const newChild = child.set(edit, shift + SHIFT, hash2, key, value, added);
      if (child === newChild) {
        return this;
      }
      if (this.canEdit(edit)) {
        this.children[idx] = newChild;
        return this;
      }
      const newChildren = [...this.children];
      newChildren[idx] = newChild;
      return new ArrayNode(edit, this.count, newChildren);
    } else {
      added.value = true;
      const newChild = new LeafNode(edit, hash2, key, value);
      if (this.canEdit(edit)) {
        this.children[idx] = newChild;
        this.count++;
        this._size = undefined;
        return this;
      }
      const newChildren = [...this.children];
      newChildren[idx] = newChild;
      return new ArrayNode(edit, this.count + 1, newChildren);
    }
  }
  remove(edit, shift, hash2, key, removed) {
    const idx = mask(hash2, shift);
    const child = this.children[idx];
    if (!child) {
      return this;
    }
    const newChild = child.remove(edit, shift + SHIFT, hash2, key, removed);
    if (!removed.value) {
      return this;
    }
    const newCount = this.count - (newChild ? 0 : 1);
    if (newCount < MIN_ARRAY_NODE) {
      return this.pack(edit, idx, newChild);
    }
    if (child === newChild) {
      return this;
    }
    if (this.canEdit(edit)) {
      this.children[idx] = newChild;
      if (!newChild) {
        this.count = newCount;
      }
      this._size = undefined;
      return this;
    }
    const newChildren = [...this.children];
    newChildren[idx] = newChild;
    return new ArrayNode(edit, newCount, newChildren);
  }
  pack(edit, excludeIdx, newChild) {
    const children = [];
    let bitmap = 0;
    let bit = 1;
    for (let i = 0;i < this.children.length; i++) {
      const child = i === excludeIdx ? newChild : this.children[i];
      if (child) {
        children.push(child);
        bitmap |= bit;
      }
      bit <<= 1;
    }
    return new IndexedNode(edit, bitmap, children);
  }
  iterator() {
    let childIndex = 0;
    let currentIterator;
    return {
      next: () => {
        while (childIndex < this.children.length) {
          const child = this.children[childIndex];
          if (!child) {
            childIndex++;
            continue;
          }
          if (!currentIterator) {
            currentIterator = child.iterator();
          }
          const result2 = currentIterator.next();
          if (!result2.done) {
            return result2;
          }
          currentIterator = undefined;
          childIndex++;
        }
        return {
          done: true,
          value: undefined
        };
      }
    };
  }
  [Symbol.iterator]() {
    return this.iterator();
  }
}

class HashMapImpl {
  [HashMapTypeId] = HashMapTypeId;
  _editable;
  _edit;
  _root;
  _size;
  constructor(editable, edit, root, size2) {
    this._editable = editable;
    this._edit = edit;
    this._root = root;
    this._size = size2;
  }
  get size() {
    return this._size;
  }
  [Symbol.iterator]() {
    return this._root.iterator();
  }
  [symbol2](that) {
    if (isHashMap(that)) {
      const thatImpl = that;
      if (this.size !== thatImpl.size) {
        return false;
      }
      for (const [key, value] of this) {
        const otherValue = pipe(that, get2(key));
        if (isNone2(otherValue) || !equals(value, otherValue.value)) {
          return false;
        }
      }
      return true;
    }
    return false;
  }
  [symbol]() {
    let hash2 = string("HashMap");
    for (const [key, value] of this) {
      hash2 = hash2 ^ hash(key) + hash(value);
    }
    return hash2;
  }
  [NodeInspectSymbol]() {
    return toJson(this);
  }
  toString() {
    return `HashMap(${format(Array.from(this))})`;
  }
  toJSON() {
    return {
      _id: "HashMap",
      values: Array.from(this).map(([k, v]) => [toJson(k), toJson(v)])
    };
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
}
var emptyNode = /* @__PURE__ */ new EmptyNode;
var isHashMap = (u) => hasProperty(u, HashMapTypeId);
var empty6 = () => new HashMapImpl(false, 0, emptyNode, 0);
var fromIterable3 = (entries) => {
  let root = emptyNode;
  let size2 = 0;
  const added = {
    value: false
  };
  for (const [key, value] of entries) {
    const hash2 = hash(key);
    added.value = false;
    root = root.set(NaN, 0, hash2, key, value, added);
    if (added.value) {
      size2++;
    }
  }
  return new HashMapImpl(false, 0, root, size2);
};
var get2 = /* @__PURE__ */ dual(2, (self, key) => {
  const impl = self;
  return impl._root.get(0, hash(key), key);
});
var has = /* @__PURE__ */ dual(2, (self, key) => {
  const impl = self;
  return impl._root.has(0, hash(key), key);
});
var set = /* @__PURE__ */ dual(3, (self, key, value) => {
  const impl = self;
  const hash2 = hash(key);
  const added = {
    value: false
  };
  const edit = impl._editable ? impl._edit : NaN;
  const newRoot = impl._root.set(edit, 0, hash2, key, value, added);
  if (impl._editable) {
    impl._root = newRoot;
    if (added.value) {
      impl._size++;
    }
    return self;
  }
  if (impl._root === newRoot) {
    return self;
  }
  return new HashMapImpl(false, impl._edit, newRoot, impl._size + (added.value ? 1 : 0));
});
var keys2 = (self) => {
  const iterator = self[Symbol.iterator]();
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      const result2 = iterator.next();
      if (result2.done) {
        return {
          done: true,
          value: undefined
        };
      }
      return {
        done: false,
        value: result2.value[0]
      };
    }
  };
};
var entries = (self) => {
  const iterator = self[Symbol.iterator]();
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      return iterator.next();
    }
  };
};
var size2 = (self) => self.size;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/HashMap.js
var isHashMap2 = isHashMap;
var fromIterable4 = fromIterable3;
var entries2 = entries;
var toEntries = (self) => Array.from(entries2(self));
var size3 = size2;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/hashSet.js
var HashSetTypeId = "~effect/collections/HashSet";
var HashSetProto = {
  [symbol]() {
    return hash(HashSetTypeId);
  },
  [symbol2](that) {
    return isHashSet(that) && size4(this) === size4(that) && every2(this, (value) => has2(that, value));
  },
  [Symbol.iterator]() {
    return keys2(keyMap(this));
  },
  toString() {
    return `HashSet(${format(Array.from(this))})`;
  },
  toJSON() {
    return {
      _id: "HashSet",
      values: toJson(Array.from(this))
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var makeImpl = (keyMap) => {
  const set2 = Object.create(HashSetProto);
  set2[HashSetTypeId] = HashSetTypeId;
  set2.keyMap = keyMap;
  return set2;
};
var isHashSet = (u) => hasProperty(u, HashSetTypeId);
var keyMap = (self) => self.keyMap;
var fromIterable5 = (values2) => {
  let map9 = empty6();
  for (const value of values2) {
    map9 = set(map9, value, true);
  }
  return makeImpl(map9);
};
var has2 = (self, value) => has(keyMap(self), value);
var size4 = (self) => size2(keyMap(self));
var every2 = (self, predicate) => {
  for (const value of self) {
    if (!predicate(value)) {
      return false;
    }
  }
  return true;
};

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/HashSet.js
var fromIterable6 = fromIterable5;
var isHashSet2 = isHashSet;
var size5 = size4;

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/schema/annotations.js
function resolve(ast) {
  return ast.checks ? ast.checks[ast.checks.length - 1].annotations : ast.annotations;
}
function resolveAt(key) {
  return (ast) => resolve(ast)?.[key];
}
var resolveIdentifier = /* @__PURE__ */ resolveAt("identifier");
var resolveTitle = /* @__PURE__ */ resolveAt("title");
var resolveBrands = /* @__PURE__ */ resolveAt("brands");
var getExpected = /* @__PURE__ */ memoize((ast) => {
  const identifier2 = resolveIdentifier(ast);
  if (typeof identifier2 === "string")
    return identifier2;
  return ast.getExpected(getExpected);
});

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Boolean.js
var Boolean2 = globalThis.Boolean;
var ReducerOr = /* @__PURE__ */ make((a, b) => a || b, false);

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/record.js
function set2(self, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(self, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    });
  } else {
    self[key] = value;
  }
  return self;
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/redacted.js
var redactedRegistry = /* @__PURE__ */ new WeakMap;
var value = (self) => {
  if (redactedRegistry.has(self)) {
    return redactedRegistry.get(self);
  } else {
    throw new Error("Unable to get redacted value" + (self.label ? ` with label: "${self.label}"` : ""));
  }
};

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Redacted.js
var TypeId8 = "~effect/data/Redacted";
var isRedacted = (u) => hasProperty(u, TypeId8);
var make12 = (value2, options) => {
  const self = Object.create(Proto3);
  if (options?.label) {
    self.label = options.label;
  }
  redactedRegistry.set(self, value2);
  return self;
};
var Proto3 = {
  [TypeId8]: {
    _A: (_) => _
  },
  label: undefined,
  ...PipeInspectableProto,
  toJSON() {
    return this.toString();
  },
  toString() {
    return `<redacted${isString(this.label) ? ":" + this.label : ""}>`;
  },
  [symbol]() {
    return hash(redactedRegistry.get(this));
  },
  [symbol2](that) {
    return isRedacted(that) && equals(redactedRegistry.get(this), redactedRegistry.get(that));
  }
};
var value2 = value;
var makeEquivalence4 = (isEquivalent) => make2((x, y) => isEquivalent(value2(x), value2(y)));

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/SchemaIssue.js
var TypeId9 = "~effect/SchemaIssue/Issue";
function isIssue(u) {
  return hasProperty(u, TypeId9);
}

class Base {
  [TypeId9] = TypeId9;
  toString() {
    return defaultFormatter(this);
  }
}

class Filter extends Base {
  _tag = "Filter";
  actual;
  filter;
  issue;
  constructor(actual, filter7, issue) {
    super();
    this.actual = actual;
    this.filter = filter7;
    this.issue = issue;
  }
}

class Encoding extends Base {
  _tag = "Encoding";
  ast;
  actual;
  issue;
  constructor(ast, actual, issue) {
    super();
    this.ast = ast;
    this.actual = actual;
    this.issue = issue;
  }
}

class Pointer extends Base {
  _tag = "Pointer";
  path;
  issue;
  constructor(path, issue) {
    super();
    this.path = path;
    this.issue = issue;
  }
}

class MissingKey extends Base {
  _tag = "MissingKey";
  annotations;
  constructor(annotations) {
    super();
    this.annotations = annotations;
  }
}

class UnexpectedKey extends Base {
  _tag = "UnexpectedKey";
  ast;
  actual;
  constructor(ast, actual) {
    super();
    this.ast = ast;
    this.actual = actual;
  }
}

class Composite extends Base {
  _tag = "Composite";
  ast;
  actual;
  issues;
  constructor(ast, actual, issues) {
    super();
    this.ast = ast;
    this.actual = actual;
    this.issues = issues;
  }
}

class InvalidType extends Base {
  _tag = "InvalidType";
  ast;
  actual;
  constructor(ast, actual) {
    super();
    this.ast = ast;
    this.actual = actual;
  }
}

class InvalidValue extends Base {
  _tag = "InvalidValue";
  actual;
  annotations;
  constructor(actual, annotations) {
    super();
    this.actual = actual;
    this.annotations = annotations;
  }
}

class Forbidden extends Base {
  _tag = "Forbidden";
  actual;
  annotations;
  constructor(actual, annotations) {
    super();
    this.actual = actual;
    this.annotations = annotations;
  }
}

class AnyOf extends Base {
  _tag = "AnyOf";
  ast;
  actual;
  issues;
  constructor(ast, actual, issues) {
    super();
    this.ast = ast;
    this.actual = actual;
    this.issues = issues;
  }
}

class OneOf extends Base {
  _tag = "OneOf";
  ast;
  actual;
  successes;
  constructor(ast, actual, successes) {
    super();
    this.ast = ast;
    this.actual = actual;
    this.successes = successes;
  }
}
function makeFilterIssue(input, entry) {
  if (isIssue(entry)) {
    return entry;
  }
  if (typeof entry === "string") {
    return new InvalidValue(some2(input), {
      message: entry
    });
  }
  const inner = typeof entry.issue === "string" ? new InvalidValue(some2(input), {
    message: entry.issue
  }) : entry.issue;
  return new Pointer(entry.path, inner);
}
function makeSingle(input, out) {
  if (out === undefined) {
    return;
  }
  if (typeof out === "boolean") {
    return out ? undefined : new InvalidValue(some2(input));
  }
  return makeFilterIssue(input, out);
}
function make13(input, ast, out) {
  if (Array.isArray(out)) {
    if (isReadonlyArrayNonEmpty(out)) {
      if (out.length === 1) {
        return makeFilterIssue(input, out[0]);
      }
      return new Composite(ast, some2(input), map4(out, (entry) => makeFilterIssue(input, entry)));
    }
    return;
  }
  return makeSingle(input, out);
}
var defaultLeafHook = (issue) => {
  const message = findMessage(issue);
  if (message !== undefined)
    return message;
  switch (issue._tag) {
    case "InvalidType":
      return getExpectedMessage(getExpected(issue.ast), formatOption(issue.actual));
    case "InvalidValue":
      return `Invalid data ${formatOption(issue.actual)}`;
    case "MissingKey":
      return "Missing key";
    case "UnexpectedKey":
      return `Unexpected key with value ${format(issue.actual)}`;
    case "Forbidden":
      return "Forbidden operation";
    case "OneOf":
      return `Expected exactly one member to match the input ${format(issue.actual)}`;
  }
};
var defaultCheckHook = (issue) => {
  return findMessage(issue.issue) ?? findMessage(issue);
};
function makeFormatterStandardSchemaV1(options) {
  return (issue) => ({
    issues: toDefaultIssues(issue, [], options?.leafHook ?? defaultLeafHook, options?.checkHook ?? defaultCheckHook)
  });
}
function getExpectedMessage(expected, actual) {
  return `Expected ${expected}, got ${actual}`;
}
function toDefaultIssues(issue, path, leafHook, checkHook) {
  switch (issue._tag) {
    case "Filter": {
      const message = checkHook(issue);
      if (message !== undefined) {
        return [{
          path,
          message
        }];
      }
      switch (issue.issue._tag) {
        case "InvalidValue":
          return [{
            path,
            message: getExpectedMessage(formatCheck(issue.filter), format(issue.actual))
          }];
        default:
          return toDefaultIssues(issue.issue, path, leafHook, checkHook);
      }
    }
    case "Encoding":
      return toDefaultIssues(issue.issue, path, leafHook, checkHook);
    case "Pointer":
      return toDefaultIssues(issue.issue, [...path, ...issue.path], leafHook, checkHook);
    case "Composite":
      return issue.issues.flatMap((issue2) => toDefaultIssues(issue2, path, leafHook, checkHook));
    case "AnyOf": {
      const message = findMessage(issue);
      if (issue.issues.length === 0) {
        if (message !== undefined)
          return [{
            path,
            message
          }];
        const expected = getExpectedMessage(getExpected(issue.ast), format(issue.actual));
        return [{
          path,
          message: expected
        }];
      }
      return issue.issues.flatMap((issue2) => toDefaultIssues(issue2, path, leafHook, checkHook));
    }
    default:
      return [{
        path,
        message: leafHook(issue)
      }];
  }
}
function formatCheck(check) {
  const expected = check.annotations?.expected;
  if (typeof expected === "string")
    return expected;
  switch (check._tag) {
    case "Filter":
      return "<filter>";
    case "FilterGroup":
      return check.checks.map((check2) => formatCheck(check2)).join(" & ");
  }
}
function makeFormatterDefault() {
  return (issue) => toDefaultIssues(issue, [], defaultLeafHook, defaultCheckHook).map(formatDefaultIssue).join(`
`);
}
var defaultFormatter = /* @__PURE__ */ makeFormatterDefault();
function formatDefaultIssue(issue) {
  let out = issue.message;
  if (issue.path && issue.path.length > 0) {
    const path = formatPath(issue.path);
    out += `
  at ${path}`;
  }
  return out;
}
function findMessage(issue) {
  switch (issue._tag) {
    case "InvalidType":
    case "OneOf":
    case "Composite":
    case "AnyOf":
      return getMessageAnnotation(issue.ast.annotations);
    case "InvalidValue":
    case "Forbidden":
      return getMessageAnnotation(issue.annotations);
    case "MissingKey":
      return getMessageAnnotation(issue.annotations, "messageMissingKey");
    case "UnexpectedKey":
      return getMessageAnnotation(issue.ast.annotations, "messageUnexpectedKey");
    case "Filter":
      return getMessageAnnotation(issue.filter.annotations);
    case "Encoding":
      return findMessage(issue.issue);
  }
}
function getMessageAnnotation(annotations, type = "message") {
  const message = annotations?.[type];
  if (typeof message === "string")
    return message;
}
function formatOption(actual) {
  if (isNone2(actual))
    return "no value provided";
  return format(actual.value);
}
function redact2(issue) {
  switch (issue._tag) {
    case "MissingKey":
      return issue;
    case "Forbidden":
      return new Forbidden(map(issue.actual, make12), issue.annotations);
    case "Filter":
      return new Filter(make12(issue.actual), issue.filter, redact2(issue.issue));
    case "Pointer":
      return new Pointer(issue.path, redact2(issue.issue));
    case "Encoding":
    case "InvalidType":
    case "InvalidValue":
    case "Composite":
      return new InvalidValue(map(issue.actual, make12));
    case "AnyOf":
    case "OneOf":
    case "UnexpectedKey":
      return new InvalidValue(some2(make12(issue.actual)));
  }
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/schema/cause.js
function getSchemaIssue(cause) {
  let issue;
  for (const reason of cause.reasons) {
    if (!isFailReason2(reason) || !isIssue(reason.error)) {
      return;
    }
    issue ??= reason.error;
  }
  return issue;
}
function getSchemaIssueOrThrow(cause, message) {
  const issue = getSchemaIssue(cause);
  if (issue === undefined) {
    throw new Error(message, {
      cause
    });
  }
  return issue;
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/SchemaGetter.js
class Getter extends Class {
  run;
  constructor(run) {
    super();
    this.run = run;
  }
  map(f) {
    return new Getter((oe, options) => this.run(oe, options).pipe(mapEager2(map(f))));
  }
  compose(other) {
    if (isPassthrough(this)) {
      return other;
    }
    if (isPassthrough(other)) {
      return this;
    }
    return new Getter((oe, options) => this.run(oe, options).pipe(flatMapEager2((ot) => other.run(ot, options))));
  }
}
function fail6(f) {
  return new Getter((oe) => fail5(f(oe)));
}
function forbidden(message) {
  return fail6((oe) => new Forbidden(oe, {
    message: message(oe)
  }));
}
var passthrough_ = /* @__PURE__ */ new Getter(succeed5);
function isPassthrough(getter) {
  return getter.run === passthrough_.run;
}
function passthrough() {
  return passthrough_;
}
function onSome(f) {
  return new Getter((oe, options) => isNone2(oe) ? succeedNone2 : f(oe.value, options));
}
function transform(f) {
  return transformOptional(map(f));
}
function transformOrFail(f) {
  return onSome((e, options) => f(e, options).pipe(mapEager2(some2)));
}
function transformOptional(f) {
  return new Getter((oe) => succeed5(f(oe)));
}
function omit() {
  return new Getter(() => succeedNone2);
}
function withDefault(defaultValue) {
  return new Getter((o) => {
    const filtered = filter(o, isNotUndefined);
    return isSome2(filtered) ? succeed5(filtered) : mapEager2(defaultValue, some2);
  });
}
function String3() {
  return transform(globalThis.String);
}
function Number4() {
  return transform(globalThis.Number);
}
function BigInt3() {
  return transform(globalThis.BigInt);
}
function Date3() {
  return transform((u) => new globalThis.Date(u));
}
function trim2() {
  return transform(trim);
}
function parseJson(options) {
  return onSome((input) => try_2({
    try: () => some2(JSON.parse(input, options?.reviver)),
    catch: (e) => new InvalidValue(some2(input), {
      message: globalThis.String(e)
    })
  }));
}
function stringifyJson(options) {
  return onSome((input) => try_2({
    try: () => some2(JSON.stringify(input, options?.replacer, options?.space)),
    catch: (e) => new InvalidValue(some2(input), {
      message: globalThis.String(e)
    })
  }));
}
function encodeBase642() {
  return transform(encodeBase64);
}
function encodeBase64Url2() {
  return transform(encodeBase64Url);
}
function encodeHex2() {
  return transform(encodeHex);
}
function decodeBase642() {
  return transformOrFail((input) => mapErrorEager2(fromResult2(decodeBase64(input)), (e) => new InvalidValue(some2(input), {
    message: e.message
  })));
}
function decodeBase64String2() {
  return transformOrFail((input) => match2(decodeBase64String(input), {
    onFailure: (e) => fail5(new InvalidValue(some2(input), {
      message: e.message
    })),
    onSuccess: succeed5
  }));
}
function decodeBase64Url2() {
  return transformOrFail((input) => match2(decodeBase64Url(input), {
    onFailure: (e) => fail5(new InvalidValue(some2(input), {
      message: e.message
    })),
    onSuccess: succeed5
  }));
}
function decodeBase64UrlString2() {
  return transformOrFail((input) => match2(decodeBase64UrlString(input), {
    onFailure: (e) => fail5(new InvalidValue(some2(input), {
      message: e.message
    })),
    onSuccess: succeed5
  }));
}
function decodeHex2() {
  return transformOrFail((input) => match2(decodeHex(input), {
    onFailure: (e) => fail5(new InvalidValue(some2(input), {
      message: e.message
    })),
    onSuccess: succeed5
  }));
}
function decodeHexString2() {
  return transformOrFail((input) => match2(decodeHexString(input), {
    onFailure: (e) => fail5(new InvalidValue(some2(input), {
      message: e.message
    })),
    onSuccess: succeed5
  }));
}
function encodeUriComponent() {
  return transform(encodeURIComponent);
}
function decodeUriComponent() {
  return transformOrFail((input) => {
    try {
      return succeed5(globalThis.decodeURIComponent(input));
    } catch (e) {
      return fail5(new InvalidValue(some2(input), {
        message: e instanceof URIError ? e.message : "Invalid URI component"
      }));
    }
  });
}
function dateTimeUtcFromInput() {
  return transformOrFail((input) => {
    return match(make9(input), {
      onNone: () => fail5(new InvalidValue(some2(input), {
        message: "Invalid DateTime input"
      })),
      onSome: (dt) => succeed5(toUtc2(dt))
    });
  });
}
function decodeFormData() {
  return transform((input) => makeTreeRecord(Array.from(input.entries())));
}
var collectFormDataEntries = /* @__PURE__ */ collectBracketPathEntries((value3) => typeof value3 === "string" || typeof Blob !== "undefined" && value3 instanceof Blob);
function encodeFormData() {
  return transform((input) => {
    const out = new FormData;
    if (typeof input === "object" && input !== null) {
      const entries3 = collectFormDataEntries(input);
      entries3.forEach(([key, value3]) => {
        out.append(key, value3);
      });
    }
    return out;
  });
}
function decodeURLSearchParams() {
  return transform((input) => makeTreeRecord(Array.from(input.entries())));
}
var collectURLSearchParamsEntries = /* @__PURE__ */ collectBracketPathEntries(isString);
function encodeURLSearchParams() {
  return transform((input) => {
    if (typeof input === "object" && input !== null) {
      return new URLSearchParams(collectURLSearchParamsEntries(input));
    }
    return new URLSearchParams;
  });
}
var INDEX_REGEXP = /^\d+$/;
function bracketPathToTokens(bracketPath) {
  if (bracketPath === "") {
    return [""];
  }
  const replaced = bracketPath.replace(/\[(.*?)\]/g, ".$1");
  const parts = replaced.split(".");
  const start = replaced.startsWith(".") ? 1 : 0;
  return parts.slice(start).map((part) => INDEX_REGEXP.test(part) ? globalThis.Number(part) : part);
}
function makeTreeRecord(bracketPathEntries) {
  const out = {};
  bracketPathEntries.forEach(([key, value3]) => {
    const tokens = bracketPathToTokens(key);
    let cur = out;
    tokens.forEach((token, i) => {
      const isLast = i === tokens.length - 1;
      if (Array.isArray(cur) && token === "") {
        if (isLast) {
          cur.push(value3);
        } else {
          const next = tokens[i + 1];
          const shouldBeArray = typeof next === "number" || next === "";
          const index2 = cur.length;
          if (cur[index2] === undefined) {
            cur[index2] = shouldBeArray ? [] : {};
          }
          cur = cur[index2];
        }
      } else if (isLast) {
        if (Array.isArray(cur[token])) {
          cur[token].push(value3);
        } else if (Object.prototype.hasOwnProperty.call(cur, token)) {
          cur[token] = [cur[token], value3];
        } else {
          cur[token] = value3;
        }
      } else {
        const next = tokens[i + 1];
        const shouldBeArray = typeof next === "number" || next === "";
        if (cur[token] === undefined) {
          cur[token] = shouldBeArray ? [] : {};
        }
        cur = cur[token];
      }
    });
  });
  return out;
}
function collectBracketPathEntries(isLeaf) {
  return (input) => {
    const bracketPathEntries = [];
    function append2(key, value3) {
      if (isLeaf(value3)) {
        bracketPathEntries.push([key, value3]);
      } else if (Array.isArray(value3)) {
        const allLeaves = value3.every(isLeaf);
        if (allLeaves) {
          value3.forEach((v) => {
            bracketPathEntries.push([key, v]);
          });
        } else {
          value3.forEach((v, i) => {
            append2(`${key}[${i}]`, v);
          });
        }
      } else if (typeof value3 === "object" && value3 !== null) {
        for (const [k, v] of Object.entries(value3)) {
          append2(`${key}[${k}]`, v);
        }
      }
    }
    for (const [key, value3] of Object.entries(input)) {
      append2(key, value3);
    }
    return bracketPathEntries;
  };
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/SchemaTransformation.js
class Middleware {
  _tag = "Middleware";
  decode;
  encode;
  constructor(decode, encode) {
    this.decode = decode;
    this.encode = encode;
  }
  flip() {
    return new Middleware(this.encode, this.decode);
  }
}
var TypeId10 = "~effect/SchemaTransformation/Transformation";

class Transformation {
  [TypeId10] = TypeId10;
  _tag = "Transformation";
  decode;
  encode;
  constructor(decode, encode) {
    this.decode = decode;
    this.encode = encode;
  }
  flip() {
    return new Transformation(this.encode, this.decode);
  }
  compose(other) {
    return new Transformation(this.decode.compose(other.decode), other.encode.compose(this.encode));
  }
}
function isTransformation(u) {
  return hasProperty(u, TypeId10);
}
var make14 = (options) => {
  if (isTransformation(options)) {
    return options;
  }
  return new Transformation(options.decode, options.encode);
};
function transformOrFail2(options) {
  return new Transformation(transformOrFail(options.decode), transformOrFail(options.encode));
}
function transform2(options) {
  return new Transformation(transform(options.decode), transform(options.encode));
}
function transformOptional2(options) {
  return new Transformation(transformOptional(options.decode), transformOptional(options.encode));
}
function trim3() {
  return new Transformation(trim2(), passthrough());
}
var passthrough_2 = /* @__PURE__ */ new Transformation(/* @__PURE__ */ passthrough(), /* @__PURE__ */ passthrough());
function passthrough2() {
  return passthrough_2;
}
var numberFromString = /* @__PURE__ */ new Transformation(/* @__PURE__ */ Number4(), /* @__PURE__ */ String3());
var bigintFromString = /* @__PURE__ */ new Transformation(/* @__PURE__ */ BigInt3(), /* @__PURE__ */ String3());
var dateFromString = /* @__PURE__ */ new Transformation(/* @__PURE__ */ Date3(), /* @__PURE__ */ transform(formatDate));
var durationFromString = /* @__PURE__ */ transformOrFail2({
  decode: (s) => match(fromInput(s), {
    onNone: () => fail5(new InvalidValue(some2(s), {
      message: `Invalid Duration string: ${s}`
    })),
    onSome: succeed5
  }),
  encode: (duration) => succeed5(globalThis.String(duration))
});
var durationFromNanos = /* @__PURE__ */ transformOrFail2({
  decode: (i) => succeed5(nanos(i)),
  encode: (a) => match(toNanos(a), {
    onNone: () => fail5(new InvalidValue(some2(a), {
      message: `Unable to encode ${a} into a bigint`
    })),
    onSome: (nanos2) => succeed5(nanos2)
  })
});
var durationFromMillis = /* @__PURE__ */ transform2({
  decode: (i) => millis(i),
  encode: (a) => toMillis(a)
});
var isJsonError = (input) => isObject(input) && typeof input["message"] === "string";
var decodeJsonError = (input) => {
  const hasCause = Object.hasOwn(input, "cause");
  const err = hasCause ? new Error(input.message, {
    cause: decodeDefect(input.cause)
  }) : new Error(input.message);
  if (typeof input.name === "string" && input.name !== "Error")
    err.name = input.name;
  if (typeof input.stack === "string")
    err.stack = input.stack;
  return err;
};
var encodeUnknownAsJson = (input) => {
  try {
    const json = formatJson(input);
    return json === undefined ? format(input) : JSON.parse(json);
  } catch {
    return format(input);
  }
};
var encodeJsonError = (input, options, encodeDefect) => {
  const encoded = {
    name: input.name,
    message: typeof input.message === "string" ? input.message : ""
  };
  if (options?.includeStack && typeof input.stack === "string") {
    encoded.stack = input.stack;
  }
  if (!options?.excludeCause && input.cause !== undefined) {
    encoded.cause = encodeDefect(input.cause);
  }
  return encoded;
};
var makeEncodeDefect = (options) => {
  const seen = new WeakSet;
  const encode = (input) => {
    if (isError(input)) {
      if (seen.has(input)) {
        return "[Circular]";
      }
      seen.add(input);
      const encoded = encodeJsonError(input, options, encode);
      seen.delete(input);
      return encoded;
    }
    return encodeUnknownAsJson(input);
  };
  return encode;
};
var decodeDefect = (input) => isJsonError(input) ? decodeJsonError(input) : input;
var errorFromJsonError = (options) => transform2({
  decode: decodeJsonError,
  encode: (input) => makeEncodeDefect(options)(input)
});
var defectFromJson = (options) => transform2({
  decode: decodeDefect,
  encode: makeEncodeDefect(options)
});
function optionFromNullOr() {
  return transform2({
    decode: fromNullOr,
    encode: getOrNull
  });
}
function optionFromUndefinedOr() {
  return transform2({
    decode: fromUndefinedOr,
    encode: getOrUndefined
  });
}
function optionFromNullishOr(options) {
  return transform2({
    decode: fromNullishOr,
    encode: options?.onNoneEncoding === null ? getOrNull : getOrUndefined
  });
}
function optionFromOptionalKey() {
  return transformOptional2({
    decode: some2,
    encode: flatten
  });
}
function optionFromOptional() {
  return transformOptional2({
    decode: (ot) => ot.pipe(filter(isNotUndefined), some2),
    encode: flatten
  });
}
var urlFromString = /* @__PURE__ */ transformOrFail2({
  decode: (s) => URL.canParse(s) ? succeed5(new URL(s)) : fail5(new InvalidValue(some2(s), {
    message: `Invalid URL string: ${s}`
  })),
  encode: (url) => succeed5(url.href)
});
var bigDecimalFromString = /* @__PURE__ */ transformOrFail2({
  decode: (s) => {
    const result2 = fromString(s);
    return isNone2(result2) ? fail5(new InvalidValue(some2(s), {
      message: `Invalid BigDecimal string: ${s}`
    })) : succeed5(result2.value);
  },
  encode: (bd) => succeed5(format2(bd))
});
var uint8ArrayFromBase64String = /* @__PURE__ */ new Transformation(/* @__PURE__ */ decodeBase642(), /* @__PURE__ */ encodeBase642());
var stringFromBase64String = /* @__PURE__ */ new Transformation(/* @__PURE__ */ decodeBase64String2(), /* @__PURE__ */ encodeBase642());
var stringFromBase64UrlString = /* @__PURE__ */ new Transformation(/* @__PURE__ */ decodeBase64UrlString2(), /* @__PURE__ */ encodeBase64Url2());
var stringFromHexString = /* @__PURE__ */ new Transformation(/* @__PURE__ */ decodeHexString2(), /* @__PURE__ */ encodeHex2());
var stringFromUriComponent = /* @__PURE__ */ new Transformation(/* @__PURE__ */ decodeUriComponent(), /* @__PURE__ */ encodeUriComponent());
var fromJsonString = /* @__PURE__ */ new Transformation(/* @__PURE__ */ parseJson(), /* @__PURE__ */ stringifyJson());
var fromFormData = /* @__PURE__ */ new Transformation(/* @__PURE__ */ decodeFormData(), /* @__PURE__ */ encodeFormData());
var fromURLSearchParams = /* @__PURE__ */ new Transformation(/* @__PURE__ */ decodeURLSearchParams(), /* @__PURE__ */ encodeURLSearchParams());
var timeZoneOffsetFromNumber = /* @__PURE__ */ transform2({
  decode: (n) => zoneMakeOffset2(n),
  encode: (tz) => tz.offset
});
var timeZoneNamedFromString = /* @__PURE__ */ transformOrFail2({
  decode: (s) => {
    return match(zoneMakeNamed2(s), {
      onNone: () => fail5(new InvalidValue(some2(s), {
        message: `Invalid IANA time zone: ${s}`
      })),
      onSome: succeed5
    });
  },
  encode: (tz) => succeed5(tz.id)
});
var timeZoneFromString = /* @__PURE__ */ transformOrFail2({
  decode: (s) => {
    return match(zoneFromString2(s), {
      onNone: () => fail5(new InvalidValue(some2(s), {
        message: `Invalid time zone: ${s}`
      })),
      onSome: succeed5
    });
  },
  encode: (tz) => succeed5(zoneToString2(tz))
});
var dateTimeUtcFromString = /* @__PURE__ */ transformOrFail2({
  decode: (s) => {
    return match(make9(s), {
      onNone: () => fail5(new InvalidValue(some2(s), {
        message: `Invalid UTC DateTime string: ${s}`
      })),
      onSome: (result2) => succeed5(toUtc2(result2))
    });
  },
  encode: (utc) => succeed5(formatIso2(utc))
});
var dateTimeZonedFromString = /* @__PURE__ */ transformOrFail2({
  decode: (s) => {
    return match(makeZonedFromString2(s), {
      onNone: () => fail5(new InvalidValue(some2(s), {
        message: `Invalid Zoned DateTime string: ${s}`
      })),
      onSome: succeed5
    });
  },
  encode: (zoned) => succeed5(formatIsoZoned2(zoned))
});

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/SchemaAST.js
function makeGuard(tag) {
  return (ast) => ast._tag === tag;
}
function isAST(u) {
  return hasProperty(u, TypeId11) && u[TypeId11] === TypeId11;
}
var isDeclaration = /* @__PURE__ */ makeGuard("Declaration");
var isNever2 = /* @__PURE__ */ makeGuard("Never");
var isLiteral = /* @__PURE__ */ makeGuard("Literal");
var isUniqueSymbol = /* @__PURE__ */ makeGuard("UniqueSymbol");
var isArrays = /* @__PURE__ */ makeGuard("Arrays");
var isObjects = /* @__PURE__ */ makeGuard("Objects");
var isUnion = /* @__PURE__ */ makeGuard("Union");
class Link {
  to;
  transformation;
  constructor(to, transformation) {
    this.to = to;
    this.transformation = transformation;
  }
}
var defaultParseOptions = {};

class Context {
  isOptional;
  isMutable;
  defaultValue;
  annotations;
  constructor(isOptional, isMutable, defaultValue = undefined, annotations = undefined) {
    this.isOptional = isOptional;
    this.isMutable = isMutable;
    this.defaultValue = defaultValue;
    this.annotations = annotations;
  }
}
var TypeId11 = "~effect/Schema";

class Base2 {
  [TypeId11] = TypeId11;
  annotations;
  checks;
  encoding;
  context;
  constructor(annotations = undefined, checks = undefined, encoding = undefined, context2 = undefined) {
    this.annotations = annotations;
    this.checks = checks;
    this.encoding = encoding;
    this.context = context2;
  }
  toString() {
    return `<${this._tag}>`;
  }
}

class Declaration extends Base2 {
  _tag = "Declaration";
  typeParameters;
  run;
  encodingChecks;
  constructor(typeParameters, run, annotations, checks, encoding, context2, encodingChecks) {
    super(annotations, checks, encoding, context2);
    this.typeParameters = typeParameters;
    this.run = run;
    this.encodingChecks = encodingChecks;
  }
  getParser() {
    const run = this.run(this.typeParameters);
    return (oinput, options) => {
      if (isNone2(oinput))
        return succeedNone2;
      return mapEager2(run(oinput.value, this, options), some2);
    };
  }
  _rebuild(recur, checks, encodingChecks) {
    const tps = mapOrSame(this.typeParameters, recur);
    return tps === this.typeParameters && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Declaration(tps, this.run, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  getExpected() {
    const expected = this.annotations?.expected;
    if (typeof expected === "string")
      return expected;
    return "<Declaration>";
  }
}

class Null extends Base2 {
  _tag = "Null";
  getParser() {
    return fromConst(this, null);
  }
  getExpected() {
    return "null";
  }
}
var null_ = /* @__PURE__ */ new Null;
class Undefined extends Base2 {
  _tag = "Undefined";
  getParser() {
    return fromConst(this, undefined);
  }
  toCodecJson() {
    return replaceEncoding(this, [undefinedToNull]);
  }
  getExpected() {
    return "undefined";
  }
}
var undefinedToNull = /* @__PURE__ */ new Link(null_, /* @__PURE__ */ new Transformation(/* @__PURE__ */ transform(() => {
  return;
}), /* @__PURE__ */ transform(() => null)));
var undefined_2 = /* @__PURE__ */ new Undefined;
class Void extends Base2 {
  _tag = "Void";
  getParser() {
    return fromAnyToConst(undefined);
  }
  toCodecJson() {
    return replaceEncoding(this, [undefinedToNull]);
  }
  getExpected() {
    return "void";
  }
}
var void_4 = /* @__PURE__ */ new Void;
class Never extends Base2 {
  _tag = "Never";
  getParser() {
    return fromRefinement(this, isNever);
  }
  getExpected() {
    return "never";
  }
}
var never2 = /* @__PURE__ */ new Never;

class Any extends Base2 {
  _tag = "Any";
  getParser() {
    return fromRefinement(this, isUnknown);
  }
  getExpected() {
    return "any";
  }
}
var any = /* @__PURE__ */ new Any;

class Unknown extends Base2 {
  _tag = "Unknown";
  getParser() {
    return fromRefinement(this, isUnknown);
  }
  getExpected() {
    return "unknown";
  }
}
var unknown = /* @__PURE__ */ new Unknown;

class ObjectKeyword extends Base2 {
  _tag = "ObjectKeyword";
  getParser() {
    return fromRefinement(this, isObjectKeyword);
  }
  getExpected() {
    return "object | array | function";
  }
}
var objectKeyword = /* @__PURE__ */ new ObjectKeyword;

class Enum extends Base2 {
  _tag = "Enum";
  enums;
  constructor(enums, annotations, checks, encoding, context2) {
    super(annotations, checks, encoding, context2);
    this.enums = enums;
  }
  getParser() {
    const values2 = new Set(this.enums.map(([, v]) => v));
    return fromRefinement(this, (input) => values2.has(input));
  }
  toCodecStringTree() {
    if (this.enums.some(([_, v]) => typeof v === "number")) {
      const coercions = Object.fromEntries(this.enums.map(([_, v]) => [globalThis.String(v), v]));
      return replaceEncoding(this, [new Link(new Union(Object.keys(coercions).map((k) => new Literal(k)), "anyOf"), new Transformation(transform((s) => coercions[s]), String3()))]);
    }
    return this;
  }
  getExpected() {
    return this.enums.map(([_, value3]) => JSON.stringify(value3)).join(" | ");
  }
}
function isTemplateLiteralPart(ast) {
  switch (ast._tag) {
    case "String":
    case "Number":
    case "BigInt":
      return true;
    case "Literal":
    case "TemplateLiteral":
      return ast.checks === undefined;
    case "Union":
      return ast.checks === undefined && ast.types.every(isTemplateLiteralPart);
    default:
      return false;
  }
}

class TemplateLiteral extends Base2 {
  _tag = "TemplateLiteral";
  parts;
  encodedParts;
  constructor(parts, annotations, checks, encoding, context2) {
    super(annotations, checks, encoding, context2);
    const encodedParts = [];
    for (const part of parts) {
      const encoded = toEncoded(part);
      if (isTemplateLiteralPart(encoded)) {
        encodedParts.push(encoded);
      } else {
        throw new Error(`Invalid TemplateLiteral part ${encoded._tag}`);
      }
    }
    this.parts = parts;
    this.encodedParts = encodedParts;
  }
  getParser(recur) {
    const parser = recur(this.asTemplateLiteralParser());
    return (oinput, options) => mapBothEager2(parser(oinput, options), {
      onSuccess: () => oinput,
      onFailure: (issue) => new Composite(this, oinput, [issue])
    });
  }
  getExpected() {
    return "string";
  }
  matchPart(s, options) {
    return segmentTemplateLiteralParts(this.encodedParts, s, options) === undefined ? undefined : s;
  }
  asTemplateLiteralParser() {
    const tuple = new Arrays(false, this.parts.map(partFromString), []);
    return decodeTo(string2, tuple, new Transformation(transformOrFail((s, options) => {
      const segments = segmentTemplateLiteralParts(this.encodedParts, s, options);
      if (segments !== undefined)
        return succeed5(segments);
      return fail5(new InvalidValue(some2(s), {
        message: `Expected a string matching template literal parts, got ${format(s)}`
      }));
    }), transform((parts) => parts.join(""))));
  }
}

class UniqueSymbol extends Base2 {
  _tag = "UniqueSymbol";
  symbol;
  constructor(symbol3, annotations, checks, encoding, context2) {
    super(annotations, checks, encoding, context2);
    this.symbol = symbol3;
  }
  getParser() {
    return fromConst(this, this.symbol);
  }
  toCodecStringTree() {
    return replaceEncoding(this, [symbolToString]);
  }
  getExpected() {
    return globalThis.String(this.symbol);
  }
}

class Literal extends Base2 {
  _tag = "Literal";
  literal;
  constructor(literal, annotations, checks, encoding, context2) {
    super(annotations, checks, encoding, context2);
    if (typeof literal === "number" && !globalThis.Number.isFinite(literal)) {
      throw new Error(`A numeric literal must be finite, got ${format(literal)}`);
    }
    this.literal = literal;
  }
  getParser() {
    return fromConst(this, this.literal);
  }
  matchPart(s, _options) {
    return s === globalThis.String(this.literal) ? this.literal : undefined;
  }
  toCodecJson() {
    return typeof this.literal === "bigint" ? literalToString(this) : this;
  }
  toCodecStringTree() {
    return typeof this.literal === "string" ? this : literalToString(this);
  }
  getExpected() {
    return typeof this.literal === "string" ? JSON.stringify(this.literal) : globalThis.String(this.literal);
  }
}
function literalToString(ast) {
  const literalAsString = globalThis.String(ast.literal);
  return replaceEncoding(ast, [new Link(new Literal(literalAsString), new Transformation(transform(() => ast.literal), transform(() => literalAsString)))]);
}

class String4 extends Base2 {
  _tag = "String";
  getParser() {
    return fromRefinement(this, isString);
  }
  matchPart(s, options) {
    return applyTemplateLiteralPartChecks(this, s, options);
  }
  getExpected() {
    return "string";
  }
}
var string2 = /* @__PURE__ */ new String4;

class Number5 extends Base2 {
  _tag = "Number";
  getParser() {
    return fromRefinement(this, isNumber);
  }
  matchKey(s, options) {
    return this._match(isStringNumberRegExp, s, options);
  }
  matchPart(s, options) {
    return this._match(isStringFiniteRegExp, s, options);
  }
  _match(regexp, s, options) {
    return regexp.test(s) ? applyTemplateLiteralPartChecks(this, globalThis.Number(s), options) : undefined;
  }
  toCodecJson() {
    if (this.checks && (hasCheck(this.checks, "isFinite") || hasCheck(this.checks, "isInt"))) {
      return this;
    }
    return replaceEncoding(this, [numberToJson]);
  }
  toCodecStringTree() {
    if (this.checks && (hasCheck(this.checks, "isFinite") || hasCheck(this.checks, "isInt"))) {
      return replaceEncoding(this, [finiteToString]);
    }
    return replaceEncoding(this, [numberToString]);
  }
  getExpected() {
    return "number";
  }
}
function hasCheck(checks, tag) {
  return checks.some((c) => {
    switch (c._tag) {
      case "Filter":
        return c.annotations?.meta?._tag === tag;
      case "FilterGroup":
        return hasCheck(c.checks, tag);
    }
  });
}
var number2 = /* @__PURE__ */ new Number5;

class Boolean3 extends Base2 {
  _tag = "Boolean";
  getParser() {
    return fromRefinement(this, isBoolean);
  }
  getExpected() {
    return "boolean";
  }
}
var boolean = /* @__PURE__ */ new Boolean3;

class Symbol2 extends Base2 {
  _tag = "Symbol";
  getParser() {
    return fromRefinement(this, isSymbol);
  }
  matchKey(s, options) {
    return applyTemplateLiteralPartChecks(this, s, options);
  }
  toCodecStringTree() {
    return replaceEncoding(this, [symbolToString]);
  }
  getExpected() {
    return "symbol";
  }
}
var symbol3 = /* @__PURE__ */ new Symbol2;

class BigInt4 extends Base2 {
  _tag = "BigInt";
  getParser() {
    return fromRefinement(this, isBigInt);
  }
  matchPart(s, options) {
    return isStringBigIntRegExp.test(s) ? applyTemplateLiteralPartChecks(this, globalThis.BigInt(s), options) : undefined;
  }
  toCodecStringTree() {
    return replaceEncoding(this, [bigIntToString]);
  }
  getExpected() {
    return "bigint";
  }
}
var bigInt = /* @__PURE__ */ new BigInt4;

class Arrays extends Base2 {
  _tag = "Arrays";
  isMutable;
  elements;
  rest;
  encodingChecks;
  constructor(isMutable, elements, rest, annotations, checks, encoding, context2, encodingChecks) {
    super(annotations, checks, encoding, context2);
    this.isMutable = isMutable;
    this.elements = elements;
    this.rest = rest;
    this.encodingChecks = encodingChecks;
    const i = elements.findIndex(isOptional);
    if (i !== -1 && (elements.slice(i + 1).some((e) => !isOptional(e)) || rest.length > 1)) {
      throw new Error("A required element cannot follow an optional element. ts(1257)");
    }
    if (rest.length > 1 && rest.slice(1).some(isOptional)) {
      throw new Error("An optional element cannot follow a rest element. ts(1266)");
    }
  }
  getParser(recur) {
    const ast = this;
    const elements = ast.elements.map((ast2) => ({
      ast: ast2,
      parser: recur(ast2)
    }));
    const rest = ast.rest.map((ast2) => ({
      ast: ast2,
      parser: recur(ast2)
    }));
    const elementLen = elements.length;
    const [head, ...tail] = rest;
    const tailLen = tail.length;
    function getParser(tailThreshold, index2) {
      if (index2 < elementLen) {
        return elements[index2];
      } else if (index2 >= tailThreshold) {
        return tail[index2 - tailThreshold];
      }
      return head;
    }
    return fnUntracedEager2(function* (oinput, options) {
      if (oinput._tag === "None") {
        return oinput;
      }
      const input = oinput.value;
      if (!Array.isArray(input)) {
        return yield* fail5(new InvalidType(ast, oinput));
      }
      const len = input.length;
      const state = {
        ast,
        getParser,
        oinput,
        len,
        tailThreshold: resolveTailThreshold(len, elementLen, tailLen),
        output: new globalThis.Array(len),
        issues: undefined,
        options
      };
      const concurrency = resolveConcurrency(options?.concurrency);
      const eff = parseArray(state, input, {
        concurrency: concurrency?.concurrency,
        end: ast.rest.length === 0 ? elementLen : Math.max(len, elementLen + tailLen)
      });
      if (eff)
        yield* eff;
      if (ast.rest.length === 0 && len > elementLen) {
        for (let i = elementLen;i <= len - 1; i++) {
          const issue = new Pointer([i], new UnexpectedKey(ast, input[i]));
          if (options.errors === "all") {
            if (state.issues)
              state.issues.push(issue);
            else
              state.issues = [issue];
          } else {
            return yield* fail5(new Composite(ast, oinput, [issue]));
          }
        }
      }
      if (state.issues) {
        return yield* fail5(new Composite(ast, oinput, state.issues));
      }
      return some2(state.output);
    });
  }
  _rebuild(recur, checks, encodingChecks) {
    const elements = mapOrSame(this.elements, recur);
    const rest = mapOrSame(this.rest, recur);
    return elements === this.elements && rest === this.rest && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Arrays(this.isMutable, elements, rest, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  getExpected() {
    return "array";
  }
}
var parseArray = /* @__PURE__ */ iterateEager()({
  onItem(s, item, i) {
    const value3 = i < s.len ? some2(item) : none2();
    return s.getParser(s.tailThreshold, i).parser(value3, s.options);
  },
  step(s, _, exit3, i) {
    if (exit3._tag === "Failure") {
      return wrapPropertyKeyIssue(s, s.ast, i, exit3);
    } else if (exit3.value._tag === "Some") {
      s.output[i] = exit3.value.value;
    } else {
      const p = s.getParser(s.tailThreshold, i);
      if (isOptional(p.ast))
        return;
      const issue = new Pointer([i], new MissingKey(p.ast.context?.annotations));
      if (s.options.errors === "all") {
        if (s.issues)
          s.issues.push(issue);
        else
          s.issues = [issue];
      } else {
        return fail4(new Composite(s.ast, s.oinput, [issue]));
      }
    }
  }
});
function resolveTailThreshold(inputLen, elementLen, tailLen) {
  return Math.max(elementLen, inputLen - tailLen);
}
var resolveConcurrency = (value3) => {
  value3 = value3 === "unbounded" ? Infinity : value3 ?? 1;
  return value3 > 1 ? {
    concurrency: value3
  } : undefined;
};
var wrapPropertyKeyIssue = (s, ast, key, exit3) => {
  if (exit3.cause.reasons.length === 0) {
    return exit3;
  }
  const issue = getSchemaIssue(exit3.cause);
  if (issue === undefined) {
    return failCause2(map6(exit3.cause, (issue2) => new Composite(ast, s.oinput, [new Pointer([key], issue2)])));
  }
  const pointer = new Pointer([key], issue);
  if (s.options.errors === "all") {
    if (s.issues)
      s.issues.push(pointer);
    else
      s.issues = [pointer];
  } else {
    return fail4(new Composite(ast, s.oinput, [pointer]));
  }
};
var FINITE_PATTERN = "[+-]?\\d*\\.?\\d+(?:[Ee][+-]?\\d+)?";
function getIndexSignatureKeys(input, parameter, options = defaultParseOptions) {
  let stringKeys;
  let symbolKeys;
  function go(parameter2) {
    switch (parameter2._tag) {
      case "String":
      case "TemplateLiteral":
        return (stringKeys ??= Object.keys(input)).filter((k) => parameter2.matchPart(k, options) !== undefined);
      case "Number":
        return (stringKeys ??= Object.keys(input)).filter((k) => parameter2.matchKey(k, options) !== undefined);
      case "Symbol":
        return (symbolKeys ??= Object.getOwnPropertySymbols(input)).filter((k) => parameter2.matchKey(k, options) !== undefined);
      case "Union":
        return [...new Set(parameter2.types.flatMap(go))];
      default:
        return [];
    }
  }
  return go(parameterFromPropertyKey(toEncoded(parameter)));
}

class PropertySignature {
  name;
  type;
  constructor(name, type) {
    this.name = name;
    this.type = type;
  }
}

class KeyValueCombiner {
  decode;
  encode;
  constructor(decode, encode) {
    this.decode = decode;
    this.encode = encode;
  }
  flip() {
    return new KeyValueCombiner(this.encode, this.decode);
  }
}
function isIndexSignatureParameterSide(ast) {
  switch (ast._tag) {
    case "String":
    case "Number":
    case "Symbol":
    case "TemplateLiteral":
      return true;
    case "Union":
      return ast.types.every(isIndexSignatureParameterSide);
    default:
      return false;
  }
}
function isIndexSignatureParameter(ast) {
  return isIndexSignatureParameterSide(ast) && isIndexSignatureParameterSide(toEncoded(ast));
}

class IndexSignature {
  parameter;
  type;
  merge;
  constructor(parameter, type, merge2) {
    if (!isIndexSignatureParameter(parameter)) {
      throw new Error(`Invalid index signature parameter ${parameter._tag}`);
    }
    this.parameter = parameter;
    this.type = type;
    this.merge = merge2;
    if (isOptional(type) && !containsUndefined(type)) {
      throw new Error("Cannot use `Schema.optionalKey` with index signatures, use `Schema.optional` instead.");
    }
  }
}

class Objects extends Base2 {
  _tag = "Objects";
  propertySignatures;
  indexSignatures;
  encodingChecks;
  constructor(propertySignatures, indexSignatures, annotations, checks, encoding, context2, encodingChecks) {
    super(annotations, checks, encoding, context2);
    this.propertySignatures = propertySignatures;
    this.indexSignatures = indexSignatures;
    this.encodingChecks = encodingChecks;
    const duplicates = propertySignatures.map((ps) => ps.name).filter((name, i, arr) => arr.indexOf(name) !== i);
    if (duplicates.length > 0) {
      throw new Error(`Duplicate identifiers: ${JSON.stringify(duplicates)}. ts(2300)`);
    }
  }
  getParser(recur) {
    const ast = this;
    const expectedKeys = [];
    const expectedKeysSet = new Set;
    const properties = [];
    for (const ps of ast.propertySignatures) {
      expectedKeys.push(ps.name);
      expectedKeysSet.add(ps.name);
      properties.push({
        ps,
        parser: recur(ps.type),
        name: ps.name,
        type: ps.type
      });
    }
    const indexCount = ast.indexSignatures.length;
    if (ast.propertySignatures.length === 0 && ast.indexSignatures.length === 0) {
      return fromRefinement(ast, isNotNullish);
    }
    const parseIndexes = indexCount > 0 ? iterateEager()({
      onItem: fnUntracedEager2(function* (s, [key, is]) {
        const parserKey = recur(parameterFromPropertyKey(is.parameter));
        const effKey = parserKey(some2(key), s.options);
        const exitKey = effectIsExit(effKey) ? effKey : yield* exit2(effKey);
        if (exitKey._tag === "Failure") {
          const eff = wrapPropertyKeyIssue(s, ast, key, exitKey);
          if (eff)
            yield* eff;
          return;
        }
        const value3 = some2(s.input[key]);
        const parserValue = recur(is.type);
        const effValue = parserValue(value3, s.options);
        const exitValue = effectIsExit(effValue) ? effValue : yield* exit2(effValue);
        if (exitValue._tag === "Failure") {
          const eff = wrapPropertyKeyIssue(s, ast, key, exitValue);
          if (eff)
            yield* eff;
          return;
        } else if (exitKey.value._tag === "Some" && exitValue.value._tag === "Some") {
          const k2 = exitKey.value.value;
          if (expectedKeysSet.has(key) || expectedKeysSet.has(k2)) {
            return;
          }
          const v2 = exitValue.value.value;
          if (is.merge && is.merge.decode && Object.hasOwn(s.out, k2)) {
            const [k, v] = is.merge.decode.combine([k2, s.out[k2]], [k2, v2]);
            set2(s.out, k, v);
          } else {
            set2(s.out, k2, v2);
          }
        }
      }),
      step: (_s, _, exit3) => exit3._tag === "Failure" ? exit3 : undefined
    }) : undefined;
    return fnUntracedEager2(function* (oinput, options) {
      if (oinput._tag === "None") {
        return oinput;
      }
      const input = oinput.value;
      if (!(typeof input === "object" && input !== null && !Array.isArray(input))) {
        return yield* fail5(new InvalidType(ast, oinput));
      }
      const out = {};
      const state = {
        ast,
        oinput,
        input,
        out,
        issues: undefined,
        options
      };
      const errorsAllOption = options.errors === "all";
      const onExcessPropertyError = options.onExcessProperty === "error";
      const onExcessPropertyPreserve = options.onExcessProperty === "preserve";
      let inputKeys;
      if (ast.indexSignatures.length === 0 && (onExcessPropertyError || onExcessPropertyPreserve)) {
        inputKeys = Reflect.ownKeys(input);
        for (let i = 0;i < inputKeys.length; i++) {
          const key = inputKeys[i];
          if (!expectedKeysSet.has(key)) {
            if (onExcessPropertyError) {
              const issue = new Pointer([key], new UnexpectedKey(ast, input[key]));
              if (errorsAllOption) {
                if (state.issues) {
                  state.issues.push(issue);
                } else {
                  state.issues = [issue];
                }
                continue;
              } else {
                return yield* fail5(new Composite(ast, oinput, [issue]));
              }
            } else {
              set2(out, key, input[key]);
            }
          }
        }
      }
      const concurrency = resolveConcurrency(options?.concurrency);
      const eff = parseProperties(state, properties, concurrency);
      if (eff)
        yield* eff;
      if (parseIndexes) {
        const keyPairs = empty2();
        for (let i = 0;i < indexCount; i++) {
          const is = ast.indexSignatures[i];
          const keys3 = getIndexSignatureKeys(input, is.parameter, options);
          for (let j = 0;j < keys3.length; j++) {
            const key = keys3[j];
            keyPairs.push([key, is]);
          }
        }
        const eff2 = parseIndexes(state, keyPairs, concurrency);
        if (eff2)
          yield* eff2;
      }
      if (state.issues) {
        return yield* fail5(new Composite(ast, oinput, state.issues));
      }
      if (options.propertyOrder === "original") {
        const keys3 = (inputKeys ?? Reflect.ownKeys(input)).concat(expectedKeys);
        const preserved = {};
        for (const key of keys3) {
          if (Object.hasOwn(out, key)) {
            set2(preserved, key, out[key]);
          }
        }
        return some2(preserved);
      }
      return some2(out);
    });
  }
  _rebuild(recur, recurParameter, flipMerge, checks, encodingChecks) {
    const props = mapOrSame(this.propertySignatures, (ps) => {
      const t = recur(ps.type);
      return t === ps.type ? ps : new PropertySignature(ps.name, t);
    });
    const indexes = mapOrSame(this.indexSignatures, (is) => {
      const p = recurParameter(is.parameter);
      const t = recur(is.type);
      const merge2 = flipMerge ? is.merge?.flip() : is.merge;
      return p === is.parameter && t === is.type && merge2 === is.merge ? is : new IndexSignature(p, t, merge2);
    });
    return props === this.propertySignatures && indexes === this.indexSignatures && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Objects(props, indexes, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, recur, true, this.encodingChecks, this.checks);
  }
  recur(recur, recurParameter = recur) {
    return this._rebuild(recur, recurParameter, false, this.checks, this.encodingChecks);
  }
  getExpected() {
    if (this.propertySignatures.length === 0 && this.indexSignatures.length === 0)
      return "object | array";
    return "object";
  }
}
var parseProperties = /* @__PURE__ */ iterateEager()({
  onItem(s, p) {
    const value3 = Object.hasOwn(s.input, p.name) ? some2(s.input[p.name]) : none2();
    return p.parser(value3, s.options);
  },
  step(s, p, exit3) {
    if (exit3._tag === "Failure") {
      return wrapPropertyKeyIssue(s, s.ast, p.name, exit3);
    } else if (exit3.value._tag === "Some") {
      set2(s.out, p.name, exit3.value.value);
    } else if (!isOptional(p.type)) {
      const issue = new Pointer([p.name], new MissingKey(p.type.context?.annotations));
      if (s.options.errors === "all") {
        if (s.issues)
          s.issues.push(issue);
        else
          s.issues = [issue];
        return;
      } else {
        return fail4(new Composite(s.ast, s.oinput, [issue]));
      }
    }
  }
});
function combineChecks(a, b) {
  if (!a)
    return b;
  if (!b)
    return a;
  return [...a, ...b];
}
function struct(fields, checks, annotations) {
  return new Objects(Reflect.ownKeys(fields).map((key) => {
    return new PropertySignature(key, fields[key].ast);
  }), [], annotations, checks);
}
function getAST(self) {
  return self.ast;
}
function tuple(elements, checks = undefined) {
  return new Arrays(false, elements.map((e) => e.ast), [], undefined, checks);
}
function union4(members, mode, checks) {
  return new Union(members.map(getAST), mode, undefined, checks);
}
function structWithRest(ast, records) {
  if (ast.encoding || records.some((r) => r.encoding)) {
    throw new Error("StructWithRest does not support encodings");
  }
  let propertySignatures = ast.propertySignatures;
  let indexSignatures = ast.indexSignatures;
  let checks = ast.checks;
  for (const record of records) {
    propertySignatures = propertySignatures.concat(record.propertySignatures);
    indexSignatures = indexSignatures.concat(record.indexSignatures);
    checks = combineChecks(checks, record.checks);
  }
  return new Objects(propertySignatures, indexSignatures, undefined, checks);
}
function tupleWithRest(ast, rest) {
  if (ast.encoding) {
    throw new Error("TupleWithRest does not support encodings");
  }
  return new Arrays(ast.isMutable, ast.elements, rest, undefined, ast.checks);
}
function getCandidateTypes(ast) {
  switch (ast._tag) {
    case "Null":
      return ["null"];
    case "Undefined":
      return ["undefined"];
    case "String":
    case "TemplateLiteral":
      return ["string"];
    case "Number":
      return ["number"];
    case "Boolean":
      return ["boolean"];
    case "Symbol":
    case "UniqueSymbol":
      return ["symbol"];
    case "BigInt":
      return ["bigint"];
    case "Arrays":
      return ["array"];
    case "ObjectKeyword":
      return ["object", "array", "function"];
    case "Objects":
      return ast.propertySignatures.length || ast.indexSignatures.length ? ["object"] : ["object", "array"];
    case "Enum":
      return Array.from(new Set(ast.enums.map(([, v]) => typeof v)));
    case "Literal":
      return [typeof ast.literal];
    case "Union":
      return Array.from(new Set(ast.types.flatMap(getCandidateTypes)));
    default:
      return ["null", "undefined", "string", "number", "boolean", "symbol", "bigint", "object", "array", "function"];
  }
}
function collectSentinels(ast) {
  switch (ast._tag) {
    default:
      return [];
    case "Declaration": {
      const s = ast.annotations?.["~sentinels"];
      return Array.isArray(s) ? s : [];
    }
    case "Objects":
      return ast.propertySignatures.flatMap((ps) => {
        const type = ps.type;
        if (!isOptional(type)) {
          if (isLiteral(type)) {
            return [{
              key: ps.name,
              literal: type.literal
            }];
          }
          if (isUniqueSymbol(type)) {
            return [{
              key: ps.name,
              literal: type.symbol
            }];
          }
        }
        return [];
      });
    case "Arrays":
      return ast.elements.flatMap((e, i) => {
        return isLiteral(e) && !isOptional(e) ? [{
          key: i,
          literal: e.literal
        }] : [];
      });
    case "Suspend":
      return collectSentinels(ast.thunk());
  }
}
var candidateIndexCache = /* @__PURE__ */ new WeakMap;
function getIndex(types) {
  let idx = candidateIndexCache.get(types);
  if (idx)
    return idx;
  idx = {};
  for (const a of types) {
    const encoded = toEncoded(a);
    if (isNever2(encoded))
      continue;
    const types2 = getCandidateTypes(encoded);
    const sentinels = collectSentinels(encoded);
    idx.byType ??= {};
    for (const t of types2)
      (idx.byType[t] ??= []).push(a);
    if (sentinels.length > 0) {
      idx.bySentinel ??= new Map;
      for (const {
        key,
        literal
      } of sentinels) {
        let m = idx.bySentinel.get(key);
        if (!m)
          idx.bySentinel.set(key, m = new Map);
        let arr = m.get(literal);
        if (!arr)
          m.set(literal, arr = []);
        arr.push(a);
      }
    } else {
      idx.otherwise ??= {};
      for (const t of types2)
        (idx.otherwise[t] ??= []).push(a);
    }
  }
  candidateIndexCache.set(types, idx);
  return idx;
}
function filterLiterals(input) {
  return (ast) => {
    const encoded = toEncoded(ast);
    return encoded._tag === "Literal" ? encoded.literal === input : encoded._tag === "UniqueSymbol" ? encoded.symbol === input : true;
  };
}
function getCandidates(input, types) {
  const idx = getIndex(types);
  const runtimeType = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
  if (idx.bySentinel) {
    const base = idx.otherwise?.[runtimeType] ?? [];
    if (runtimeType === "object" || runtimeType === "array") {
      for (const [k, m] of idx.bySentinel) {
        if (Object.hasOwn(input, k)) {
          const match7 = m.get(input[k]);
          if (match7)
            return [...match7, ...base].filter(filterLiterals(input));
        }
      }
    }
    return base;
  }
  return (idx.byType?.[runtimeType] ?? []).filter(filterLiterals(input));
}

class Union extends Base2 {
  _tag = "Union";
  types;
  mode;
  encodingChecks;
  constructor(types, mode, annotations, checks, encoding, context2, encodingChecks) {
    super(annotations, checks, encoding, context2);
    this.types = types;
    this.mode = mode;
    this.encodingChecks = encodingChecks;
  }
  getParser(recur) {
    const ast = this;
    return (oinput, options) => {
      if (oinput._tag === "None") {
        return succeed5(oinput);
      }
      const input = oinput.value;
      const candidates = getCandidates(input, ast.types);
      const state = {
        ast,
        recur,
        oinput,
        input,
        out: undefined,
        successes: [],
        issues: undefined,
        options
      };
      const concurrency = resolveConcurrency(options?.concurrency);
      const eff = parseUnion(state, candidates, concurrency);
      if (!eff) {
        return state.out ? succeed5(state.out) : fail5(new AnyOf(ast, input, state.issues ?? []));
      }
      return flatMap4(eff, (_) => {
        return state.out ? succeed5(state.out) : fail5(new AnyOf(ast, input, state.issues ?? []));
      });
    };
  }
  _rebuild(recur, checks, encodingChecks) {
    const types = mapOrSame(this.types, recur);
    return types === this.types && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Union(types, this.mode, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  matchPart(s, options) {
    for (const type of this.types) {
      const out = type.matchPart(s, options);
      if (out !== undefined)
        return out;
    }
    return;
  }
  getExpected(getExpected2) {
    const expected = this.annotations?.expected;
    if (typeof expected === "string")
      return expected;
    if (this.types.length === 0)
      return "never";
    const types = this.types.map((type) => {
      const encoded = toEncoded(type);
      switch (encoded._tag) {
        case "Arrays": {
          const literals = encoded.elements.filter(isLiteral);
          if (literals.length > 0) {
            return `${formatIsMutable(encoded.isMutable)}[ ${literals.map((e) => getExpected2(e) + formatIsOptional(e.context?.isOptional)).join(", ")}, ... ]`;
          }
          break;
        }
        case "Objects": {
          const literals = encoded.propertySignatures.filter((ps) => isLiteral(ps.type));
          if (literals.length > 0) {
            return `{ ${literals.map((ps) => `${formatIsMutable(ps.type.context?.isMutable)}${formatPropertyKey(ps.name)}${formatIsOptional(ps.type.context?.isOptional)}: ${getExpected2(ps.type)}`).join(", ")}, ... }`;
          }
          break;
        }
      }
      return getExpected2(encoded);
    });
    return Array.from(new Set(types)).join(" | ");
  }
}
var parseUnion = /* @__PURE__ */ iterateEager()({
  onItem(s, ast) {
    const parser = s.recur(ast);
    return parser(s.oinput, s.options);
  },
  step(s, candidate, exit3) {
    if (exit3._tag === "Failure") {
      const issue = getSchemaIssue(exit3.cause);
      if (issue === undefined) {
        return exit3;
      }
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
    } else {
      if (s.out && s.ast.mode === "oneOf") {
        s.successes.push(candidate);
        return fail4(new OneOf(s.ast, s.input, s.successes));
      }
      s.out = exit3.value;
      s.successes.push(candidate);
      if (s.ast.mode === "anyOf") {
        return void_2;
      }
    }
  }
});
var nonFiniteLiterals = /* @__PURE__ */ new Union([/* @__PURE__ */ new Literal("Infinity"), /* @__PURE__ */ new Literal("-Infinity"), /* @__PURE__ */ new Literal("NaN")], "anyOf");
var numberToJson = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([number2, nonFiniteLiterals], "anyOf"), /* @__PURE__ */ new Transformation(/* @__PURE__ */ Number4(), /* @__PURE__ */ transform((n) => globalThis.Number.isFinite(n) ? n : globalThis.String(n))));
function formatIsMutable(isMutable) {
  return isMutable ? "" : "readonly ";
}
function formatIsOptional(isOptional) {
  return isOptional ? "?" : "";
}
function memoizeThunk(f) {
  let done2 = false;
  let a;
  return () => {
    if (done2) {
      return a;
    }
    a = f();
    done2 = true;
    return a;
  };
}

class Suspend extends Base2 {
  _tag = "Suspend";
  thunk;
  constructor(thunk, annotations, checks, encoding, context2) {
    if (checks !== undefined) {
      throw new Error("Cannot add checks to Suspend");
    }
    super(annotations, undefined, encoding, context2);
    this.thunk = memoizeThunk(thunk);
  }
  getParser(recur) {
    return recur(this.thunk());
  }
  recur(recur) {
    return new Suspend(() => recur(this.thunk()), this.annotations, undefined, undefined, this.context);
  }
  getExpected(getExpected2) {
    return getExpected2(this.thunk());
  }
}

class Filter2 extends Class {
  _tag = "Filter";
  run;
  annotations;
  aborted;
  constructor(run, annotations = undefined, aborted = false) {
    super();
    this.run = run;
    this.annotations = annotations;
    this.aborted = aborted;
  }
  annotate(annotations) {
    return new Filter2(this.run, {
      ...this.annotations,
      ...annotations
    }, this.aborted);
  }
  abort() {
    return new Filter2(this.run, this.annotations, true);
  }
  and(other, annotations) {
    return new FilterGroup([this, other], annotations);
  }
}

class FilterGroup extends Class {
  _tag = "FilterGroup";
  checks;
  annotations;
  constructor(checks, annotations = undefined) {
    super();
    this.checks = checks;
    this.annotations = annotations;
  }
  annotate(annotations) {
    return new FilterGroup(this.checks, {
      ...this.annotations,
      ...annotations
    });
  }
  and(other, annotations) {
    return new FilterGroup([this, other], annotations);
  }
}
function makeFilter(filter7, annotations, aborted = false) {
  return new Filter2((input, ast, options) => make13(input, ast, filter7(input, ast, options)), annotations, aborted);
}
function makeFilterByGuard(is, annotations) {
  return new Filter2((input) => is(input) ? undefined : new InvalidValue(some2(input)), annotations, true);
}
function isPattern(regExp, annotations) {
  const source = regExp.source;
  return makeFilter((s) => regExp.test(s), {
    expected: `a string matching the RegExp ${source}`,
    meta: {
      _tag: "isPattern",
      regExp
    },
    arbitrary: {
      constraint: {
        patterns: [regExp.source]
      }
    },
    ...annotations
  });
}
function modifyOwnPropertyDescriptors(ast, f) {
  const d = Object.getOwnPropertyDescriptors(ast);
  f(d);
  return Object.create(Object.getPrototypeOf(ast), d);
}
function replaceEncoding(ast, encoding) {
  if (ast.encoding === encoding) {
    return ast;
  }
  return modifyOwnPropertyDescriptors(ast, (d) => {
    d.encoding.value = encoding;
  });
}
function replaceContext(ast, context2) {
  if (ast.context === context2) {
    return ast;
  }
  return modifyOwnPropertyDescriptors(ast, (d) => {
    d.context.value = context2;
  });
}
function getLastEncoding(ast) {
  return ast.encoding ? getLastEncoding(ast.encoding[ast.encoding.length - 1].to) : ast;
}
function annotate(ast, annotations) {
  if (ast.checks) {
    const last = ast.checks[ast.checks.length - 1];
    return replaceChecks(ast, append(ast.checks.slice(0, -1), last.annotate(annotations)));
  }
  return modifyOwnPropertyDescriptors(ast, (d) => {
    d.annotations.value = {
      ...d.annotations.value,
      ...annotations
    };
  });
}
function replaceChecks(ast, checks) {
  if (ast._tag === "Suspend" && checks !== undefined) {
    throw new Error("Cannot add checks to Suspend");
  }
  if (ast.checks === checks) {
    return ast;
  }
  return modifyOwnPropertyDescriptors(ast, (d) => {
    d.checks.value = checks;
  });
}
function appendChecks(ast, checks) {
  return replaceChecks(ast, combineChecks(ast.checks, checks));
}
function updateLastLink(encoding, f) {
  const links = encoding;
  const last = links[links.length - 1];
  const to = f(last.to);
  if (to !== last.to) {
    return append(encoding.slice(0, encoding.length - 1), new Link(to, last.transformation));
  }
  return encoding;
}
function applyToLastLink(f) {
  return (ast) => ast.encoding ? replaceEncoding(ast, updateLastLink(ast.encoding, f)) : ast;
}
function applyToSelfOrLastLinkEncoding(f) {
  function out(ast) {
    return ast.encoding ? replaceEncoding(ast, updateLastLink(ast.encoding, out)) : f(ast);
  }
  return memoize(out);
}
function middlewareDecoding(ast, middleware) {
  return appendTransformation(ast, middleware, toType(ast));
}
function middlewareEncoding(ast, middleware) {
  return appendTransformation(toEncoded(ast), middleware, ast);
}
function appendTransformation(from, transformation, to) {
  const link = new Link(from, transformation);
  return replaceEncoding(to, to.encoding ? [...to.encoding, link] : [link]);
}
function brand(ast, brand2) {
  const existing = resolveBrands(ast);
  const brands = existing ? [...existing, brand2] : [brand2];
  return annotate(ast, {
    brands
  });
}
function mapOrSame(as2, f) {
  let changed = false;
  const out = new Array(as2.length);
  for (let i = 0;i < as2.length; i++) {
    const a = as2[i];
    const fa = f(a);
    if (fa !== a) {
      changed = true;
    }
    out[i] = fa;
  }
  return changed ? out : as2;
}
function annotateKey(ast, annotations) {
  const context2 = ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, ast.context.defaultValue, {
    ...ast.context.annotations,
    ...annotations
  }) : new Context(false, false, undefined, annotations);
  return replaceContext(ast, context2);
}
var optionalKeyLastLink = /* @__PURE__ */ applyToLastLink(optionalKey);
function optionalKey(ast) {
  const context2 = ast.context ? ast.context.isOptional === false ? new Context(true, ast.context.isMutable, ast.context.defaultValue, ast.context.annotations) : ast.context : new Context(true, false);
  return optionalKeyLastLink(replaceContext(ast, context2));
}
var mutableKeyLastLink = /* @__PURE__ */ applyToLastLink(mutableKey);
function mutableKey(ast) {
  const context2 = ast.context ? ast.context.isMutable === false ? new Context(ast.context.isOptional, true, ast.context.defaultValue, ast.context.annotations) : ast.context : new Context(false, true);
  return mutableKeyLastLink(replaceContext(ast, context2));
}
function withConstructorDefault(ast, defaultValue) {
  const transformation = new Transformation(withDefault(defaultValue), passthrough());
  const encoding = [new Link(unknown, transformation)];
  const context2 = ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, encoding, ast.context.annotations) : new Context(false, false, encoding);
  return replaceContext(ast, context2);
}
function decodeTo(from, to, transformation) {
  return appendTransformation(from, transformation, to);
}
function parseParameter(ast) {
  const literals = [];
  const parameters = [];
  function go(ast2) {
    switch (ast2._tag) {
      case "Literal":
        if (isPropertyKey(ast2.literal)) {
          literals.push(ast2.literal);
        }
        return;
      case "UniqueSymbol":
        literals.push(ast2.symbol);
        return;
      case "Never":
        return;
      case "Union":
        for (let i = 0;i < ast2.types.length; i++) {
          go(ast2.types[i]);
        }
        return;
      default:
        parameters.push(ast2);
    }
  }
  go(ast);
  return {
    literals,
    parameters
  };
}
function record(key, value3, keyValueCombiner) {
  const {
    literals,
    parameters: indexSignatures
  } = parseParameter(key);
  return new Objects(literals.map((literal) => new PropertySignature(literal, value3)), indexSignatures.map((parameter) => new IndexSignature(parameter, value3, keyValueCombiner)));
}
function isOptional(ast) {
  return ast.context?.isOptional ?? false;
}
function isMutable(ast) {
  return ast.context?.isMutable ?? false;
}
var toType = /* @__PURE__ */ memoize((ast) => {
  if (ast.encoding) {
    return toType(replaceEncoding(ast, undefined));
  }
  const out = ast;
  const type = out.recur?.(toType) ?? out;
  const encodingChecks = type.encodingChecks;
  if (encodingChecks) {
    return modifyOwnPropertyDescriptors(type, (d) => {
      d.encodingChecks.value = undefined;
      if (type === ast) {
        d.checks.value = combineChecks(type.checks, encodingChecks);
      }
    });
  }
  return type;
});
var toEncoded = /* @__PURE__ */ memoize((ast) => {
  return toType(flip2(ast));
});
function flipEncoding(ast, encoding) {
  const links = encoding;
  const len = links.length;
  const last = links[len - 1];
  const ls = [new Link(flip2(replaceEncoding(ast, undefined)), links[0].transformation.flip())];
  for (let i = 1;i < len; i++) {
    ls.unshift(new Link(flip2(links[i - 1].to), links[i].transformation.flip()));
  }
  const to = flip2(last.to);
  if (to.encoding) {
    return replaceEncoding(to, [...to.encoding, ...ls]);
  } else {
    return replaceEncoding(to, ls);
  }
}
var flip2 = /* @__PURE__ */ memoize((ast) => {
  if (ast.encoding) {
    return flipEncoding(ast, ast.encoding);
  }
  const out = ast;
  return out.flip?.(flip2) ?? out.recur?.(flip2) ?? out;
});
function containsUndefined(ast) {
  switch (ast._tag) {
    case "Undefined":
      return true;
    case "Union":
      return ast.types.some(containsUndefined);
    default:
      return false;
  }
}
function fromConst(ast, value3) {
  const succeed6 = succeedSome2(value3);
  return (oinput) => {
    if (oinput._tag === "None") {
      return succeedNone2;
    }
    return oinput.value === value3 ? succeed6 : fail5(new InvalidType(ast, oinput));
  };
}
function fromAnyToConst(value3) {
  const succeed6 = succeedSome2(value3);
  return (oinput) => oinput._tag === "None" ? succeedNone2 : succeed6;
}
function fromRefinement(ast, refinement) {
  return (oinput) => {
    if (oinput._tag === "None") {
      return succeedNone2;
    }
    return refinement(oinput.value) ? succeed5(oinput) : fail5(new InvalidType(ast, oinput));
  };
}
function applyTemplateLiteralPartChecks(ast, value3, options) {
  if (options?.disableChecks || ast.checks === undefined)
    return value3;
  const issues = [];
  collectIssues(ast.checks, value3, issues, ast, options);
  return issues.length === 0 ? value3 : undefined;
}
function segmentTemplateLiteralParts(parts, input, options) {
  const out = new Array(parts.length);
  const failures = new Set;
  function go(i, pos) {
    if (i === parts.length)
      return pos === input.length;
    const key = `${i}/${pos}`;
    if (failures.has(key))
      return false;
    const part = parts[i];
    if (i === parts.length - 1) {
      const s = input.slice(pos);
      if (part.matchPart(s, options) !== undefined) {
        out[i] = s;
        return true;
      }
    } else if (part._tag === "Literal") {
      const s = globalThis.String(part.literal);
      if (input.startsWith(s, pos) && go(i + 1, pos + s.length)) {
        out[i] = s;
        return true;
      }
    } else {
      for (let end = input.length;end >= pos; end--) {
        const s = input.slice(pos, end);
        if (part.matchPart(s, options) !== undefined && go(i + 1, end)) {
          out[i] = s;
          return true;
        }
      }
    }
    failures.add(key);
    return false;
  }
  return go(0, 0) ? out : undefined;
}
var enumsToLiterals = /* @__PURE__ */ memoize((ast) => {
  return new Union(ast.enums.map((e) => new Literal(e[1], {
    title: e[0]
  })), "anyOf");
});
var parameterFromPropertyKey = /* @__PURE__ */ applyToSelfOrLastLinkEncoding((ast) => {
  switch (ast._tag) {
    default:
      return ast;
    case "Number":
      return ast.toCodecStringTree();
    case "Union":
      return ast.recur(parameterFromPropertyKey);
  }
});
var parameterFromString = /* @__PURE__ */ applyToSelfOrLastLinkEncoding((ast) => {
  switch (ast._tag) {
    default:
      return ast;
    case "Symbol":
    case "UniqueSymbol":
      return ast.toCodecStringTree();
    case "Union":
      return ast.recur(parameterFromString);
  }
});
var partFromString = /* @__PURE__ */ applyToSelfOrLastLinkEncoding((ast) => {
  switch (ast._tag) {
    default:
      return ast;
    case "Number":
    case "Literal":
    case "BigInt":
      return ast.toCodecStringTree();
    case "Union":
      return ast.recur(partFromString);
  }
});
var STRING_PATTERN = "[\\s\\S]*?";
var isStringFiniteRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${FINITE_PATTERN}$`);
var isStringNumberRegExp = /* @__PURE__ */ new globalThis.RegExp(`(?:${FINITE_PATTERN}|Infinity|-Infinity|NaN)`);
function isStringFinite(annotations) {
  return isPattern(isStringFiniteRegExp, {
    expected: "a string representing a finite number",
    meta: {
      _tag: "isStringFinite",
      regExp: isStringFiniteRegExp
    },
    ...annotations
  });
}
var finiteString = /* @__PURE__ */ appendChecks(string2, [/* @__PURE__ */ isStringFinite()]);
var finiteToString = /* @__PURE__ */ new Link(finiteString, numberFromString);
var numberToString = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([finiteString, nonFiniteLiterals], "anyOf"), numberFromString);
var BIGINT_PATTERN = "-?\\d+";
var isStringBigIntRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${BIGINT_PATTERN}$`);
function isStringBigInt(annotations) {
  return isPattern(isStringBigIntRegExp, {
    expected: "a string representing a bigint",
    meta: {
      _tag: "isStringBigInt",
      regExp: isStringBigIntRegExp
    },
    ...annotations
  });
}
var bigIntString = /* @__PURE__ */ appendChecks(string2, [/* @__PURE__ */ isStringBigInt({
  expected: "a string representing a bigint"
})]);
var bigIntToString = /* @__PURE__ */ new Link(bigIntString, bigintFromString);
var REGEXP_PATTERN = "Symbol\\((.*)\\)";
var isStringSymbolRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${REGEXP_PATTERN}$`);
var symbolString = /* @__PURE__ */ appendChecks(string2, [/* @__PURE__ */ isStringSymbol()]);
var symbolToString = /* @__PURE__ */ new Link(symbolString, /* @__PURE__ */ new Transformation(/* @__PURE__ */ transform((description) => globalThis.Symbol.for(isStringSymbolRegExp.exec(description)[1])), /* @__PURE__ */ transformOrFail((sym) => {
  const key = globalThis.Symbol.keyFor(sym);
  if (key !== undefined) {
    return succeed5(globalThis.String(sym));
  }
  return fail5(new Forbidden(some2(sym), {
    message: "cannot serialize to string, Symbol is not registered"
  }));
})));
function isStringSymbol(annotations) {
  return isPattern(isStringSymbolRegExp, {
    expected: "a string representing a symbol",
    meta: {
      _tag: "isStringSymbol",
      regExp: isStringSymbolRegExp
    },
    ...annotations
  });
}
function collectIssues(checks, value3, issues, ast, options) {
  for (let i = 0;i < checks.length; i++) {
    const check = checks[i];
    if (check._tag === "FilterGroup") {
      collectIssues(check.checks, value3, issues, ast, options);
    } else {
      const issue = check.run(value3, ast, options);
      if (issue) {
        issues.push(new Filter(value3, check, issue));
        if (check.aborted || options?.errors !== "all") {
          return;
        }
      }
    }
  }
}
function runChecks(checks, s) {
  const issues = [];
  collectIssues(checks, s, issues, unknown, {
    errors: "all"
  });
  if (isArrayNonEmpty2(issues)) {
    const issue = new Composite(unknown, some2(s), issues);
    return fail2(issue);
  }
  return succeed2(s);
}
var ClassTypeId = "~effect/Schema/Class";
var STRUCTURAL_ANNOTATION_KEY = "~structural";
function isJson(u) {
  const onPath = new Set;
  const validated = new Set;
  return recur(u);
  function recur(u2) {
    if (u2 === null || typeof u2 === "string" || typeof u2 === "boolean") {
      return true;
    }
    if (typeof u2 === "number") {
      return globalThis.Number.isFinite(u2);
    }
    if (typeof u2 !== "object" || u2 === undefined) {
      return false;
    }
    if (onPath.has(u2)) {
      return false;
    }
    if (validated.has(u2)) {
      return true;
    }
    onPath.add(u2);
    const ok = Array.isArray(u2) ? u2.every(recur) : Object.keys(u2).every((key) => recur(u2[key]));
    onPath.delete(u2);
    if (ok) {
      validated.add(u2);
    }
    return ok;
  }
}
var Json = /* @__PURE__ */ new Declaration([], () => (input, ast) => isJson(input) ? succeed5(input) : fail5(new InvalidType(ast, some2(input))), {
  typeConstructor: {
    _tag: "effect/Json"
  },
  generation: {
    runtime: `Schema.Json`,
    Type: `Schema.Json`
  },
  expected: "JSON value",
  toCodecJson: () => new Link(unknown, passthrough2()),
  toArbitrary: () => (fc) => fc.jsonValue()
});
var MutableJson = /* @__PURE__ */ annotate(Json, {
  typeConstructor: {
    _tag: "effect/MutableJson"
  },
  generation: {
    runtime: `Schema.MutableJson`,
    Type: `Schema.MutableJson`
  }
});
var unknownToNull = /* @__PURE__ */ new Link(null_, /* @__PURE__ */ new Transformation(/* @__PURE__ */ passthrough(), /* @__PURE__ */ transform(() => null)));
var unknownToJson = /* @__PURE__ */ new Link(Json, /* @__PURE__ */ passthrough2());
function isStringTree(u) {
  const seen = new Set;
  return recur(u);
  function recur(u2) {
    if (u2 === undefined || typeof u2 === "string") {
      return true;
    }
    if (typeof u2 !== "object" || u2 === null) {
      return false;
    }
    if (seen.has(u2)) {
      return false;
    }
    seen.add(u2);
    if (Array.isArray(u2)) {
      return u2.every(recur);
    }
    return Object.keys(u2).every((key) => recur(u2[key]));
  }
}
var StringTree = /* @__PURE__ */ new Declaration([], () => (input, ast) => isStringTree(input) ? succeed5(input) : fail5(new InvalidType(ast, some2(input))), {
  expected: "StringTree"
});
var unknownToStringTree = /* @__PURE__ */ new Link(StringTree, /* @__PURE__ */ passthrough2());

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Struct.js
var pick = /* @__PURE__ */ dual(2, (self, keys3) => {
  return buildStruct(self, (k, v) => keys3.includes(k) ? [k, v] : undefined);
});
var omit2 = /* @__PURE__ */ dual(2, (self, keys3) => {
  return buildStruct(self, (k, v) => !keys3.includes(k) ? [k, v] : undefined);
});
var assign = /* @__PURE__ */ dual(2, (self, that) => {
  return {
    ...self,
    ...that
  };
});
var renameKeys = /* @__PURE__ */ dual(2, (self, mapping) => {
  return buildStruct(self, (k, v) => [Object.hasOwn(mapping, k) ? mapping[k] : k, v]);
});
var lambda = (f) => f;
function buildStruct(source, f) {
  const out = {};
  for (const k of Reflect.ownKeys(source)) {
    if (!Object.prototype.propertyIsEnumerable.call(source, k))
      continue;
    const res = f(k, source[k]);
    if (res) {
      const [nk, nv] = res;
      out[nk] = nv;
    }
  }
  return out;
}
function makeCombiner(combiners, options) {
  const omitKeyWhen = options?.omitKeyWhen ?? (() => false);
  return make3((self, that) => {
    const keys3 = Reflect.ownKeys(combiners);
    const out = {};
    for (const key of keys3) {
      const merge2 = combiners[key].combine(self[key], that[key]);
      if (omitKeyWhen(merge2))
        continue;
      out[key] = merge2;
    }
    return out;
  });
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/UndefinedOr.js
function makeReducer(combiner) {
  return make((self, that) => {
    if (self === undefined)
      return that;
    if (that === undefined)
      return self;
    return combiner.combine(self, that);
  }, undefined);
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/errors.js
function errorWithPath(message, path) {
  if (path.length > 0) {
    message += `
  at ${formatPath(path)}`;
  }
  return new Error(message);
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/schema/arbitrary.js
var arbitraryMemoMap = /* @__PURE__ */ new WeakMap;
var suspendDepthIdentifierMap = /* @__PURE__ */ new WeakMap;
var emptyRecursionStack = [];
function makeReport() {
  return {
    warnings: []
  };
}
function toReport(report) {
  return {
    warnings: report.warnings.slice()
  };
}
function arbitraryError(what) {
  return new Error(`Unable to derive an arbitrary for ${what}`);
}
var entryComparator = ([a], [b]) => equals(a, b);
function applyChecks(ast, filters, arbitrary) {
  return filters.reduce((acc, filter7) => acc.filter((a) => filter7.run(a, ast, defaultParseOptions) === undefined), arbitrary);
}
function validateArrayConstraints(constraint, label) {
  if (constraint?.minLength !== undefined && constraint.maxLength !== undefined && constraint.minLength > constraint.maxLength) {
    throw arbitraryError(`${label} constraints`);
  }
}
function lengthToFastCheckConstraints(constraint) {
  return constraint === undefined || constraint.minLength === undefined && constraint.maxLength === undefined ? undefined : {
    ...constraint.minLength !== undefined ? {
      minLength: constraint.minLength
    } : {},
    ...constraint.maxLength !== undefined ? {
      maxLength: constraint.maxLength
    } : {}
  };
}
function arrayWithConstraints(fc, item, constraint, comparator) {
  return comparator ? fc.uniqueArray(item, {
    ...constraint,
    comparator
  }) : fc.array(item, constraint);
}
function array2(fc, ctx, item, terminal = false) {
  const constraint = ctx.constraint;
  const arrayConstraints = lengthToFastCheckConstraints(constraint);
  validateArrayConstraints(arrayConstraints, "array");
  return arrayWithConstraints(fc, item, terminal ? {
    ...arrayConstraints,
    maxLength: arrayConstraints?.minLength ?? 0
  } : arrayConstraints, constraint?.unique ? equals : undefined);
}
function appendArray(fc, out, len, rest) {
  return out.chain((as2) => as2.length < len ? fc.constant(as2) : rest.map((rest2) => [...as2, ...rest2]));
}
function appendObjectEntries(out, entries3) {
  return out.chain((o) => entries3.map((entries4) => ({
    ...Object.fromEntries(entries4),
    ...o
  })));
}
var max3 = /* @__PURE__ */ makeReducer(ReducerMax);
var min3 = /* @__PURE__ */ makeReducer(ReducerMin);
var or = /* @__PURE__ */ makeReducer(ReducerOr);
var concat = /* @__PURE__ */ makeReducer(/* @__PURE__ */ makeReducerConcat());
var combiner = /* @__PURE__ */ makeCombiner({
  integer: or,
  maxLength: min3,
  minLength: max3,
  noInfinity: or,
  noNaN: or,
  patterns: concat,
  unique: or,
  valid: or
}, {
  omitKeyWhen: isUndefined
});
function mergeOrderedBound(order, self, selfExclusive, that, thatExclusive, takeComparison) {
  if (that === undefined || self === undefined) {
    return that === undefined ? [self, selfExclusive] : [that, thatExclusive];
  }
  const comparison = order(self, that);
  return comparison === takeComparison ? [that, thatExclusive] : comparison === 0 ? [self, selfExclusive || thatExclusive] : [self, selfExclusive];
}
function mergeOrderedConstraints(self, that) {
  if (self === undefined) {
    return that;
  }
  if (self.order !== that.order) {
    throw new Error("Cannot merge ordered arbitrary constraints with different Order instances");
  }
  const [minimum, exclusiveMinimum] = mergeOrderedBound(self.order, self.minimum, self.exclusiveMinimum, that.minimum, that.exclusiveMinimum, -1);
  const [maximum, exclusiveMaximum] = mergeOrderedBound(self.order, self.maximum, self.exclusiveMaximum, that.maximum, that.exclusiveMaximum, 1);
  return {
    order: self.order,
    ...minimum !== undefined ? {
      minimum
    } : {},
    ...exclusiveMinimum !== undefined ? {
      exclusiveMinimum
    } : {},
    ...maximum !== undefined ? {
      maximum
    } : {},
    ...exclusiveMaximum !== undefined ? {
      exclusiveMaximum
    } : {}
  };
}
function mergeConstraint(self, that) {
  const {
    ordered: selfOrdered,
    ...selfRest
  } = self ?? {};
  const {
    ordered: thatOrdered,
    ...thatRest
  } = that;
  const ordered = thatOrdered === undefined ? selfOrdered : mergeOrderedConstraints(selfOrdered, thatOrdered);
  const out = combiner.combine(selfRest, thatRest);
  return {
    ...out,
    ...ordered === undefined ? {} : {
      ordered
    }
  };
}
function collectChecks(checks) {
  const filters = [];
  const arbitraries = [];
  function visit(check) {
    if (check.annotations?.arbitrary) {
      arbitraries.push(check.annotations.arbitrary);
    }
    if (check._tag !== "Filter") {
      for (const child of check.checks) {
        visit(child);
      }
    } else {
      filters.push(check);
    }
  }
  checks?.forEach(visit);
  return {
    filters,
    arbitraries
  };
}
function constraintContext(arbitraries) {
  const constraintAnnotations = arbitraries.map(({
    constraint
  }) => constraint).filter(isNotUndefined);
  return (ctx) => {
    const constraint = constraintAnnotations.reduce((acc, c) => mergeConstraint(acc, c), ctx.constraint);
    return {
      ...ctx,
      constraint
    };
  };
}
function resetContext(ctx) {
  return {
    ...ctx,
    constraint: undefined
  };
}
function objectEntriesConstraints(ast, constraint, requiredKeys) {
  if (constraint === undefined || constraint.minLength === undefined && constraint.maxLength === undefined) {
    return;
  }
  if (constraint.minLength !== undefined && ast.indexSignatures.length === 0 && constraint.minLength > ast.propertySignatures.length) {
    throw arbitraryError("object property constraints");
  }
  const out = {};
  if (constraint.minLength !== undefined) {
    out.minLength = Math.max(0, constraint.minLength - requiredKeys);
  }
  if (constraint.maxLength !== undefined) {
    out.maxLength = constraint.maxLength - requiredKeys;
    if (out.maxLength < 0) {
      throw arbitraryError("object property constraints");
    }
  }
  validateArrayConstraints(out, "object property");
  return out;
}
function objectWithOptionalCount(fc, pss, orderedNames, requiredKeys, optionalNames, constraint) {
  const requiredCount = requiredKeys.length;
  if (constraint.maxLength !== undefined && constraint.maxLength < requiredCount) {
    throw arbitraryError("object property constraints");
  }
  const minOptional = constraint.minLength === undefined ? 0 : Math.max(0, constraint.minLength - requiredCount);
  const maxOptional = constraint.maxLength === undefined ? optionalNames.length : Math.min(optionalNames.length, constraint.maxLength - requiredCount);
  if (minOptional > maxOptional) {
    throw arbitraryError("object property constraints");
  }
  const full = fc.record(pss, {
    requiredKeys: [...requiredKeys, ...optionalNames]
  });
  const chosen = fc.shuffledSubarray([...optionalNames], {
    minLength: minOptional,
    maxLength: maxOptional
  });
  return fc.tuple(full, chosen).map(([base, names]) => {
    const keep = new Set([...requiredKeys, ...names]);
    const out = {};
    for (const name of orderedNames) {
      if (keep.has(name)) {
        out[name] = base[name];
      }
    }
    return out;
  });
}
function toRangeConstraints(ordered, min4, max4, error) {
  const out = {};
  if (ordered?.minimum !== undefined) {
    out.min = min4(ordered.minimum, ordered.exclusiveMinimum === true);
  }
  if (ordered?.maximum !== undefined) {
    out.max = max4(ordered.maximum, ordered.exclusiveMaximum === true);
  }
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
    throw arbitraryError(error);
  }
  return out;
}
function toIntegerConstraints(ordered) {
  return toRangeConstraints(ordered, (minimum, excluded) => excluded ? Math.floor(minimum) + 1 : Math.ceil(minimum), (maximum, excluded) => excluded ? Math.ceil(maximum) - 1 : Math.floor(maximum), "integer constraints");
}
function toFloatConstraints(constraint, ordered) {
  const out = {
    ...constraint?.noInfinity ? {
      noDefaultInfinity: true
    } : {},
    ...constraint?.noNaN ? {
      noNaN: true
    } : {},
    ...ordered?.minimum !== undefined ? {
      min: ordered.minimum
    } : {},
    ...ordered?.exclusiveMinimum !== undefined ? {
      minExcluded: ordered.exclusiveMinimum
    } : {},
    ...ordered?.maximum !== undefined ? {
      max: ordered.maximum
    } : {},
    ...ordered?.exclusiveMaximum !== undefined ? {
      maxExcluded: ordered.exclusiveMaximum
    } : {}
  };
  if (out.min !== undefined && out.max !== undefined && (out.min > out.max || out.min === out.max && (out.minExcluded || out.maxExcluded))) {
    throw arbitraryError("number constraints");
  }
  return out;
}
function toBigIntConstraints(ordered) {
  return toRangeConstraints(ordered, (minimum, excluded) => excluded ? minimum + BigInt(1) : minimum, (maximum, excluded) => excluded ? maximum - BigInt(1) : maximum, "the ordered bigint constraints");
}
function makeLazy(normal, terminal) {
  const out = (fc, ctx, recursionStack = emptyRecursionStack) => normal(fc, ctx, recursionStack);
  out.terminal = (fc, ctx, recursionStack = emptyRecursionStack) => terminal(fc, ctx, recursionStack);
  return out;
}
function same(f) {
  return makeLazy(f, f);
}
function getSuspendRecursion(fc, ast) {
  const depthIdentifier = suspendDepthIdentifierMap.get(ast) ?? fc.createDepthIdentifier();
  suspendDepthIdentifierMap.set(ast, depthIdentifier);
  return {
    maxDepth: 2,
    depthIdentifier
  };
}
function oneOf(fc, arbitraries) {
  return arbitraries.length === 0 ? undefined : arbitraries.length === 1 ? arbitraries[0] : fc.oneof(...arbitraries);
}
var finiteNumberConstraint = {
  noInfinity: true,
  noNaN: true
};
function finiteNumberContext(ctx) {
  return {
    ...ctx,
    constraint: finiteNumberConstraint
  };
}
function reportChecks(report, checks, path) {
  function visit(check, covered) {
    const arbitrary = check.annotations?.arbitrary;
    const nextCovered = covered || arbitrary?.constraint !== undefined || arbitrary?.candidate !== undefined;
    if (check._tag !== "Filter") {
      for (const child of check.checks) {
        visit(child, nextCovered);
      }
    } else if (!nextCovered) {
      const meta = check.annotations?.meta;
      const description = typeof meta === "object" && meta !== null && "_tag" in meta && typeof meta._tag === "string" ? meta._tag : check.annotations?.identifier ?? check.annotations?.expected;
      report.warnings.push({
        _tag: "OpaqueFilter",
        path,
        ...description === undefined ? {} : {
          description
        }
      });
    }
  }
  checks?.forEach((check) => visit(check, false));
}
function collectReport(ast, report) {
  const stack = new WeakSet;
  function visit(ast2, path) {
    if (stack.has(ast2)) {
      return;
    }
    stack.add(ast2);
    reportChecks(report, ast2.checks, path);
    switch (ast2._tag) {
      case "Declaration":
        ast2.typeParameters.forEach((tp) => visit(tp, path));
        break;
      case "Arrays": {
        for (const [i, type] of [...ast2.elements, ...ast2.rest].entries()) {
          visit(type, [...path, i]);
        }
        break;
      }
      case "Objects":
        ast2.propertySignatures.forEach((ps) => visit(ps.type, [...path, ps.name]));
        ast2.indexSignatures.forEach((is) => {
          visit(is.parameter, path);
          visit(is.type, path);
        });
        break;
      case "Union":
        ast2.types.forEach((type) => visit(type, path));
        break;
      case "TemplateLiteral":
        ast2.parts.forEach((part, i) => visit(toEncoded(part), [...path, i]));
        break;
      case "Suspend":
        visit(ast2.thunk(), path);
        break;
    }
    stack.delete(ast2);
  }
  visit(ast, []);
}
function applyCandidates(fc, ctx, arbitraries, base) {
  const weighted = base === undefined ? [] : [{
    arbitrary: base,
    weight: 1
  }];
  for (const {
    candidate
  } of arbitraries) {
    if (!candidate) {
      continue;
    }
    const arbitrary = candidate.make(fc, ctx);
    if (arbitrary === undefined) {
      continue;
    }
    const weight = candidate.weight ?? 1;
    if (!globalThis.Number.isInteger(weight) || weight <= 0) {
      throw arbitraryError("a candidate with an invalid weight");
    }
    weighted.push({
      arbitrary,
      weight
    });
  }
  return weighted.length === 0 ? undefined : weighted.length === 1 ? weighted[0].arbitrary : fc.oneof(...weighted);
}
function applyFilterLayer(ast, checks, fc, ctx, base) {
  const out = applyCandidates(fc, ctx, checks.arbitraries, base);
  return out === undefined ? undefined : applyChecks(ast, checks.filters, out);
}
function normalizeDerivation(output, hasTypeParameters) {
  if (!(typeof output === "object" && output !== null && ("arbitrary" in output))) {
    return {
      arbitrary: output,
      terminal: hasTypeParameters ? undefined : output
    };
  }
  const terminal = "terminal" in output ? output.terminal : hasTypeParameters ? undefined : output.arbitrary;
  return {
    arbitrary: output.arbitrary,
    terminal
  };
}
function makeTypeParameters(typeParameters, fc, ctx, recursionStack, lazyNormal) {
  return typeParameters.map((tp) => ({
    arbitrary: lazyNormal ? fc.constant(null).chain(() => tp(fc, ctx, recursionStack)) : tp(fc, ctx, recursionStack),
    terminal: tp.terminal(fc, ctx, recursionStack)
  }));
}
function filterLayer(ast, checks, normalBase, terminalBase) {
  const f = constraintContext(checks.arbitraries);
  return makeLazy((fc, ctx, recursionStack) => {
    const nextCtx = f(ctx);
    return applyFilterLayer(ast, checks, fc, nextCtx, normalBase(fc, ctx, nextCtx, recursionStack));
  }, (fc, ctx, recursionStack) => {
    const nextCtx = f(ctx);
    return applyFilterLayer(ast, checks, fc, nextCtx, terminalBase(fc, ctx, nextCtx, recursionStack));
  });
}
var memoized = /* @__PURE__ */ memoize((ast) => recur(ast, []));
function recur(ast, path) {
  const annotation = resolve(ast)?.toArbitrary;
  if (annotation) {
    const typeParameters = isDeclaration(ast) ? ast.typeParameters.map((tp) => recur(tp, path)) : [];
    const checks = collectChecks(ast.checks);
    const derive = (lazyNormal) => (fc, ctx, nextCtx, recursionStack) => normalizeDerivation(annotation(makeTypeParameters(typeParameters, fc, resetContext(ctx), recursionStack, lazyNormal))(fc, nextCtx), typeParameters.length > 0)[lazyNormal ? "terminal" : "arbitrary"];
    return filterLayer(ast, checks, derive(false), derive(true));
  }
  if (ast.checks) {
    const checks = collectChecks(ast.checks);
    const lawc = recur(replaceChecks(ast, undefined), path);
    return filterLayer(ast, checks, (fc, _ctx, nextCtx, recursionStack) => lawc(fc, nextCtx, recursionStack), (fc, _ctx, nextCtx, recursionStack) => lawc.terminal(fc, nextCtx, recursionStack));
  }
  return base(ast, path);
}
function base(ast, path) {
  switch (ast._tag) {
    case "Never":
    case "Declaration":
      throw errorWithPath(`Unsupported AST ${ast._tag}`, path);
    case "Null":
      return same((fc) => fc.constant(null));
    case "Void":
    case "Undefined":
      return same((fc) => fc.constant(undefined));
    case "Unknown":
    case "Any":
      return same((fc) => fc.anything());
    case "String":
      return same((fc, ctx) => {
        const constraint = ctx.constraint;
        const patterns = constraint?.patterns;
        return patterns ? fc.oneof(...patterns.map((pattern) => fc.stringMatching(new RegExp(pattern)))) : fc.string(lengthToFastCheckConstraints(constraint));
      });
    case "Number":
      return same((fc, ctx) => {
        const constraint = ctx.constraint;
        const ordered = constraint?.ordered?.order === Number2 ? constraint.ordered : undefined;
        return constraint?.integer ? fc.integer(toIntegerConstraints(ordered)) : fc.float(toFloatConstraints(constraint, ordered));
      });
    case "Boolean":
      return same((fc) => fc.boolean());
    case "BigInt":
      return same((fc, ctx) => {
        const ordered = ctx.constraint?.ordered?.order === BigInt2 ? ctx.constraint.ordered : undefined;
        return fc.bigInt(toBigIntConstraints(ordered));
      });
    case "Symbol":
      return same((fc) => fc.string().map(Symbol.for));
    case "Literal":
      return same((fc) => fc.constant(ast.literal));
    case "UniqueSymbol":
      return same((fc) => fc.constant(ast.symbol));
    case "ObjectKeyword":
      return same((fc) => fc.oneof(fc.object(), fc.array(fc.anything())));
    case "Enum":
      return recur(enumsToLiterals(ast), path);
    case "TemplateLiteral": {
      const parts = ast.parts.map((part, i) => recur(toEncoded(part), [...path, i]));
      return same((fc, ctx, recursionStack) => fc.tuple(...parts.map((part) => part(fc, finiteNumberContext(ctx), recursionStack))).map((segments) => segments.map((segment) => globalThis.String(segment)).join("")));
    }
    case "Arrays": {
      const elements = ast.elements.map((ast2, i) => ({
        ast: ast2,
        arbitrary: recur(ast2, [...path, i])
      }));
      const len = ast.elements.length;
      const rest = ast.rest.map((ast2, i) => ({
        ast: ast2,
        arbitrary: recur(ast2, [...path, len + i])
      }));
      const terminal = (fc, ctx, recursionStack) => {
        const reset = resetContext(ctx);
        const elementArbitraries = [];
        const optionals = [];
        let length = 0;
        for (const element of elements) {
          const out2 = element.arbitrary.terminal(fc, reset, recursionStack);
          if (isOptional(element.ast)) {
            optionals.push(out2);
            continue;
          }
          if (out2 === undefined) {
            return;
          }
          length++;
          elementArbitraries.push(out2.map(some2));
        }
        const minLength = ctx.constraint?.minLength ?? 0;
        const needsRest = isReadonlyArrayNonEmpty(rest) && minLength > length + optionals.length;
        const optionalTarget = needsRest ? optionals.length : Math.max(0, minLength - length);
        let includedOptionals = 0;
        for (const out2 of optionals) {
          if (includedOptionals >= optionalTarget || out2 === undefined) {
            elementArbitraries.push(fc.constant(none2()));
            continue;
          }
          includedOptionals++;
          length++;
          elementArbitraries.push(out2.map(some2));
        }
        if (includedOptionals < optionalTarget) {
          return;
        }
        let out = fc.tuple(...elementArbitraries).map(getSomes);
        if (isReadonlyArrayNonEmpty(rest)) {
          const [head, ...tail] = rest;
          const restCtx = ast.elements.length === 0 ? ctx : reset;
          const minRestLength = Math.max(0, minLength - length - tail.length);
          const headArbitrary = minRestLength === 0 ? undefined : head.arbitrary.terminal(fc, reset, recursionStack);
          if (minRestLength > 0 && headArbitrary === undefined) {
            return;
          }
          const restArbitrary = minRestLength === 0 ? fc.constant([]) : array2(fc, {
            ...restCtx,
            constraint: {
              ...restCtx.constraint,
              minLength: minRestLength
            }
          }, headArbitrary, true);
          out = appendArray(fc, out, len, restArbitrary);
          if (tail.length > 0) {
            const tailArbitraries = [];
            for (const element of tail) {
              const out2 = element.arbitrary.terminal(fc, reset, recursionStack);
              if (out2 === undefined) {
                return;
              }
              tailArbitraries.push(out2);
            }
            const t = fc.tuple(...tailArbitraries);
            out = appendArray(fc, out, len, t);
          }
        }
        return out;
      };
      return makeLazy((fc, ctx, recursionStack) => {
        const reset = resetContext(ctx);
        const elementArbitraries = elements.map(({
          ast: ast2,
          arbitrary
        }) => {
          const out2 = arbitrary(fc, reset, recursionStack);
          return isOptional(ast2) ? out2.chain((a) => fc.boolean().map((b) => b ? some2(a) : none2())) : out2.map(some2);
        });
        let out = fc.tuple(...elementArbitraries).map(getSomes);
        if (isReadonlyArrayNonEmpty(rest)) {
          const [head, ...tail] = rest.map(({
            arbitrary
          }) => arbitrary(fc, reset, recursionStack));
          const restArbitrary = array2(fc, ast.elements.length === 0 ? ctx : reset, head);
          out = appendArray(fc, out, len, restArbitrary);
          if (tail.length > 0) {
            const t = fc.tuple(...tail);
            out = appendArray(fc, out, len, t);
          }
        }
        if (ctx.recursion) {
          const terminalOut = terminal(fc, ctx, recursionStack);
          if (terminalOut !== undefined) {
            return fc.oneof(ctx.recursion, terminalOut, out);
          }
        }
        return out;
      }, terminal);
    }
    case "Objects": {
      const propertySignatures = ast.propertySignatures.map((ps) => ({
        ps,
        arbitrary: recur(ps.type, [...path, ps.name])
      }));
      const indexSignatures = ast.indexSignatures.map((is) => ({
        is,
        parameter: recur(is.parameter, path),
        type: recur(is.type, path)
      }));
      const terminal = (fc, ctx, recursionStack) => {
        const reset = resetContext(ctx);
        const pss = {};
        const requiredKeys = [];
        const optionals = [];
        for (const {
          ps,
          arbitrary
        } of propertySignatures) {
          const name = ps.name;
          const out2 = arbitrary.terminal(fc, reset, recursionStack);
          if (isOptional(ps.type)) {
            if (out2 !== undefined) {
              optionals.push([name, out2]);
            }
            continue;
          }
          if (out2 === undefined) {
            return;
          }
          requiredKeys.push(name);
          pss[name] = out2;
        }
        let optionalCount = Math.max(0, (ctx.constraint?.minLength ?? 0) - requiredKeys.length);
        for (const [name, out2] of optionals) {
          if (optionalCount === 0) {
            break;
          }
          optionalCount--;
          requiredKeys.push(name);
          pss[name] = out2;
        }
        if (optionalCount > 0 && ast.indexSignatures.length === 0) {
          return;
        }
        let out = fc.record(pss, {
          requiredKeys
        });
        const entriesConstraints = objectEntriesConstraints(ast, ctx.constraint, requiredKeys.length);
        const minEntries = entriesConstraints?.minLength ?? 0;
        for (const {
          parameter,
          type
        } of indexSignatures) {
          let entries3;
          if (minEntries === 0) {
            entries3 = fc.constant([]);
          } else {
            const key = parameter.terminal(fc, reset, recursionStack);
            const value3 = type.terminal(fc, reset, recursionStack);
            if (key === undefined || value3 === undefined) {
              return;
            }
            entries3 = arrayWithConstraints(fc, fc.tuple(key, value3), {
              ...entriesConstraints,
              maxLength: minEntries
            }, entryComparator);
          }
          out = appendObjectEntries(out, entries3);
        }
        return out;
      };
      return makeLazy((fc, ctx, recursionStack) => {
        const reset = resetContext(ctx);
        const pss = {};
        const orderedNames = [];
        const requiredKeys = [];
        const optionalNames = [];
        for (const {
          ps,
          arbitrary
        } of propertySignatures) {
          const name = ps.name;
          orderedNames.push(name);
          if (isOptional(ps.type)) {
            optionalNames.push(name);
          } else {
            requiredKeys.push(name);
          }
          pss[name] = arbitrary(fc, reset, recursionStack);
        }
        const constraint = ctx.constraint;
        if (optionalNames.length > 0 && indexSignatures.length === 0 && constraint !== undefined && (constraint.minLength !== undefined || constraint.maxLength !== undefined)) {
          return objectWithOptionalCount(fc, pss, orderedNames, requiredKeys, optionalNames, constraint);
        }
        let out = fc.record(pss, {
          requiredKeys
        });
        const entriesConstraints = objectEntriesConstraints(ast, ctx.constraint, requiredKeys.length);
        for (const {
          parameter,
          type
        } of indexSignatures) {
          const entry = fc.tuple(parameter(fc, reset, recursionStack), type(fc, reset, recursionStack));
          const entries3 = arrayWithConstraints(fc, entry, entriesConstraints, entryComparator);
          out = appendObjectEntries(out, entries3);
        }
        return out;
      }, terminal);
    }
    case "Union": {
      const types = ast.types.map((ast2) => recur(ast2, path));
      const terminal = (fc, ctx, recursionStack) => oneOf(fc, types.map((type) => type.terminal(fc, ctx, recursionStack)).filter(isNotUndefined));
      return makeLazy((fc, ctx, recursionStack) => {
        const arbitraries = types.map((type) => type(fc, ctx, recursionStack));
        if (ctx.recursion) {
          const terminalOut = terminal(fc, ctx, recursionStack);
          if (terminalOut !== undefined) {
            return fc.oneof(ctx.recursion, terminalOut, ...arbitraries);
          }
        }
        const out = oneOf(fc, arbitraries);
        if (out === undefined) {
          throw arbitraryError("a union with no members");
        }
        return out;
      }, terminal);
    }
    case "Suspend": {
      const memo = arbitraryMemoMap.get(ast);
      if (memo)
        return memo;
      const get3 = memoizeThunk(() => recur(ast.thunk(), path));
      const out = makeLazy((fc, ctx, recursionStack) => {
        const recursion = getSuspendRecursion(fc, ast);
        const nextCtx = {
          ...ctx,
          recursion
        };
        const nextStack = recursionStack.includes(ast) ? recursionStack : [...recursionStack, ast];
        const terminal = get3().terminal(fc, nextCtx, nextStack);
        if (terminal === undefined) {
          throw errorWithPath("Unable to derive an arbitrary for a recursive schema without a finite generation path", path);
        }
        return fc.oneof(recursion, terminal, fc.constant(null).chain(() => get3()(fc, nextCtx, nextStack)));
      }, (fc, ctx, recursionStack) => {
        if (recursionStack.includes(ast)) {
          return;
        }
        const recursion = getSuspendRecursion(fc, ast);
        return get3().terminal(fc, {
          ...ctx,
          recursion
        }, [...recursionStack, ast]);
      });
      arbitraryMemoMap.set(ast, out);
      return out;
    }
  }
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/SchemaParser.js
var recurDefaults = /* @__PURE__ */ memoize((ast) => {
  switch (ast._tag) {
    case "Declaration": {
      const getLink = ast.annotations?.[ClassTypeId];
      if (isFunction(getLink)) {
        const link = getLink(ast.typeParameters);
        const to = recurDefaults(link.to);
        return replaceEncoding(ast, to === link.to ? [link] : [new Link(to, link.transformation)]);
      }
      return ast;
    }
    case "Objects":
    case "Arrays":
      return ast.recur((ast2) => {
        const defaultValue = ast2.context?.defaultValue;
        if (defaultValue) {
          return replaceEncoding(recurDefaults(ast2), defaultValue);
        }
        return recurDefaults(ast2);
      });
    case "Suspend":
      return ast.recur(recurDefaults);
    default:
      return ast;
  }
});
function makeEffect(schema) {
  const ast = recurDefaults(toType(schema.ast));
  const parser = run(ast);
  return (input, options) => {
    return parser(input, options?.disableChecks ? options?.parseOptions ? {
      ...options.parseOptions,
      disableChecks: true
    } : {
      disableChecks: true
    } : options?.parseOptions);
  };
}
function makeOption(schema) {
  const parser = makeEffect(schema);
  return (input, options) => {
    const exit3 = runSyncExit2(parser(input, options));
    if (isSuccess3(exit3)) {
      return some2(exit3.value);
    }
    getSchemaIssueOrThrow(exit3.cause, "Option adapter can only return none for schema issues");
    return none2();
  };
}
function make15(schema) {
  const parser = makeEffect(schema);
  return (input, options) => {
    const exit3 = runSyncExit2(parser(input, options));
    if (isSuccess3(exit3)) {
      return exit3.value;
    }
    const issue = getSchemaIssueOrThrow(exit3.cause, "Constructor adapter can only throw schema issues");
    throw new Error(issue.toString(), {
      cause: issue
    });
  };
}
function is(schema) {
  return _is(schema.ast);
}
function _is(ast) {
  const parser = asExit(run(toType(ast)));
  return (input) => {
    const exit3 = parser(input, defaultParseOptions);
    if (isSuccess3(exit3)) {
      return true;
    }
    getSchemaIssueOrThrow(exit3.cause, "Type guard adapter can only return false for schema issues");
    return false;
  };
}
function _issue(ast) {
  const parser = run(ast);
  return (input, options) => {
    const exit3 = runSyncExit2(parser(input, options));
    if (isSuccess3(exit3)) {
      return;
    }
    return getSchemaIssueOrThrow(exit3.cause, "Issue adapter can only return schema issues");
  };
}
function asserts(schema, input) {
  const parser = asExit(run(toType(schema.ast)));
  const exit3 = parser(input, defaultParseOptions);
  if (isFailure3(exit3)) {
    const issue = getSchemaIssueOrThrow(exit3.cause, "Assertion adapter can only throw schema issues");
    throw new Error(issue.toString(), {
      cause: issue
    });
  }
}
function decodeUnknownEffect(schema, options) {
  const parser = run(schema.ast);
  return options === undefined ? parser : (input, overrideOptions) => parser(input, mergeParseOptions(options, overrideOptions));
}
var decodeEffect = decodeUnknownEffect;
function decodeUnknownExit(schema, options) {
  return asExit(decodeUnknownEffect(schema, options));
}
function decodeUnknownOption(schema, options) {
  return asOption(decodeUnknownEffect(schema, options));
}
var decodeOption = decodeUnknownOption;
function decodeUnknownResult(schema, options) {
  return asResult(decodeUnknownEffect(schema, options));
}
function decodeUnknownSync(schema, options) {
  return asSync(decodeUnknownEffect(schema, options));
}
var decodeSync = decodeUnknownSync;
function encodeUnknownEffect(schema, options) {
  const parser = run(flip2(schema.ast));
  return options === undefined ? parser : (input, overrideOptions) => parser(input, mergeParseOptions(options, overrideOptions));
}
function encodeUnknownExit(schema, options) {
  return asExit(encodeUnknownEffect(schema, options));
}
function encodeUnknownOption(schema, options) {
  return asOption(encodeUnknownEffect(schema, options));
}
var encodeOption = encodeUnknownOption;
function encodeUnknownResult(schema, options) {
  return asResult(encodeUnknownEffect(schema, options));
}
function encodeUnknownSync(schema, options) {
  return asSync(encodeUnknownEffect(schema, options));
}
var encodeSync = encodeUnknownSync;
var mergeParseOptions = (options, overrideOptions) => overrideOptions === undefined ? options : {
  ...options,
  ...overrideOptions
};
function run(ast) {
  const parser = recur2(ast);
  return (input, options) => flatMapEager2(parser(some2(input), options ?? defaultParseOptions), (oa) => {
    if (oa._tag === "None") {
      return fail5(new InvalidValue(oa));
    }
    return succeed5(oa.value);
  });
}
function asExit(parser) {
  return (input, options) => runSyncExit2(parser(input, options));
}
function asOption(parser) {
  const parserExit = asExit(parser);
  return (input, options) => {
    const exit3 = parserExit(input, options);
    if (isSuccess3(exit3)) {
      return some2(exit3.value);
    }
    getSchemaIssueOrThrow(exit3.cause, "Option adapter can only return none for schema issues");
    return none2();
  };
}
function asResult(parser) {
  const parserExit = asExit(parser);
  return (input, options) => {
    const exit3 = parserExit(input, options);
    if (isSuccess3(exit3)) {
      return succeed2(exit3.value);
    }
    return fail2(getSchemaIssueOrThrow(exit3.cause, "Result adapter can only return schema issues"));
  };
}
function asSync(parser) {
  const parserExit = asExit(parser);
  return (input, options) => {
    const exit3 = parserExit(input, options);
    if (isSuccess3(exit3)) {
      return exit3.value;
    }
    const issue = getSchemaIssueOrThrow(exit3.cause, "Sync adapter can only throw schema issues");
    throw new Error(issue.toString(), {
      cause: issue
    });
  };
}
function mapSchemaIssueEffect(self, f) {
  return catchCause2(self, (cause) => failCauseSync2(() => map6(cause, f)));
}
var recur2 = /* @__PURE__ */ memoize((ast) => {
  let parser;
  const checks = ast.checks;
  const encoding = ast.encoding;
  const links = encoding;
  const len = links?.length ?? 0;
  const encodingChecks = ast.encodingChecks;
  const astOptions = (checks ? checks[checks.length - 1].annotations : ast.annotations)?.["parseOptions"];
  if (!ast.context && !encoding && !checks && !encodingChecks) {
    return (ou, options) => {
      parser ??= ast.getParser(recur2);
      if (astOptions) {
        options = {
          ...options,
          ...astOptions
        };
      }
      return parser(ou, options);
    };
  }
  const isStructural = isArrays(ast) || isObjects(ast) || isDeclaration(ast) && ast.typeParameters.length > 0;
  const structuralChecks = checks && isStructural ? checks.filter((check) => check.annotations?.[STRUCTURAL_ANNOTATION_KEY]) : undefined;
  return (ou, options) => {
    if (astOptions) {
      options = {
        ...options,
        ...astOptions
      };
    }
    let srou;
    if (links) {
      for (let i = len - 1;i >= 0; i--) {
        const link = links[i];
        const to = link.to;
        const parser2 = recur2(to);
        srou = srou ? flatMapEager2(srou, (ou2) => parser2(ou2, options)) : parser2(ou, options);
        if (link.transformation._tag === "Transformation") {
          const getter = link.transformation.decode;
          srou = flatMapEager2(srou, (ou2) => getter.run(ou2, options));
        } else {
          srou = link.transformation.decode(srou, options);
        }
      }
      srou = mapSchemaIssueEffect(srou, (issue) => new Encoding(ast, ou, issue));
    }
    parser ??= ast.getParser(recur2);
    const parseLocal = (localOu) => {
      let sroa2 = parser(localOu, options);
      if (encodingChecks && !options?.disableChecks) {
        sroa2 = flatMapEager2(sroa2, (oa) => {
          if (isSome2(localOu) && isSome2(oa)) {
            const issues = [];
            collectIssues(encodingChecks, localOu.value, issues, ast, options);
            if (isArrayNonEmpty2(issues)) {
              return fail5(new Composite(ast, localOu, issues));
            }
          }
          return succeed5(oa);
        });
      }
      if (checks && !options?.disableChecks) {
        if (options?.errors === "all" && structuralChecks && structuralChecks.length > 0 && isSome2(localOu)) {
          sroa2 = mapSchemaIssueEffect(sroa2, (issue) => {
            const issues = [];
            collectIssues(structuralChecks, localOu.value, issues, ast, options);
            const out = isArrayNonEmpty2(issues) ? issue._tag === "Composite" && issue.ast === ast ? new Composite(ast, issue.actual, [...issue.issues, ...issues]) : new Composite(ast, localOu, [issue, ...issues]) : issue;
            return out;
          });
        }
        sroa2 = flatMapEager2(sroa2, (oa) => {
          if (isSome2(oa)) {
            const value3 = oa.value;
            const issues = [];
            collectIssues(checks, value3, issues, ast, options);
            if (isArrayNonEmpty2(issues)) {
              return fail5(new Composite(ast, oa, issues));
            }
          }
          return succeed5(oa);
        });
      }
      return sroa2;
    };
    const sroa = srou ? flatMapEager2(srou, parseLocal) : parseLocal(ou);
    return sroa;
  };
});

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/schema/equivalence.js
var toEquivalence = /* @__PURE__ */ memoize((ast) => {
  return recur3(ast, []);
});
function recur3(ast, path) {
  const annotation = resolve(ast)?.["toEquivalence"];
  if (annotation) {
    return annotation(isDeclaration(ast) ? ast.typeParameters.map((tp) => recur3(tp, path)) : []);
  }
  switch (ast._tag) {
    case "Never":
      throw errorWithPath(`Unsupported AST ${ast._tag}`, path);
    case "Declaration":
    case "Null":
    case "Undefined":
    case "Void":
    case "Unknown":
    case "Any":
    case "String":
    case "Number":
    case "Boolean":
    case "BigInt":
    case "Symbol":
    case "Literal":
    case "UniqueSymbol":
    case "ObjectKeyword":
    case "Enum":
    case "TemplateLiteral":
      return equals;
    case "Arrays": {
      const elements = ast.elements.map((e, i) => recur3(e, [...path, i]));
      const len = ast.elements.length;
      const rest = ast.rest.map((r, i) => recur3(r, [...path, len + i]));
      return make2((a, b) => {
        if (!Array.isArray(a) || !Array.isArray(b)) {
          return false;
        }
        const len2 = a.length;
        if (len2 !== b.length) {
          return false;
        }
        let i = 0;
        for (;i < Math.min(len2, ast.elements.length); i++) {
          if (!elements[i](a[i], b[i])) {
            return false;
          }
        }
        if (rest.length > 0) {
          const [head, ...tail] = rest;
          for (;i < len2 - tail.length; i++) {
            if (!head(a[i], b[i])) {
              return false;
            }
          }
          for (let j = 0;j < tail.length; j++) {
            i += j;
            if (!tail[j](a[i], b[i])) {
              return false;
            }
          }
        }
        return true;
      });
    }
    case "Objects": {
      if (ast.propertySignatures.length === 0 && ast.indexSignatures.length === 0) {
        return equals;
      }
      const propertySignatures = ast.propertySignatures.map((ps) => recur3(ps.type, [...path, ps.name]));
      const indexSignatures = ast.indexSignatures.map((is2) => recur3(is2.type, path));
      return make2((a, b) => {
        if (!isObject(a) || !isObject(b)) {
          return false;
        }
        for (let i = 0;i < propertySignatures.length; i++) {
          const ps = ast.propertySignatures[i];
          const name = ps.name;
          const aHas = Object.hasOwn(a, name);
          const bHas = Object.hasOwn(b, name);
          if (isOptional(ps.type)) {
            if (aHas !== bHas) {
              return false;
            }
          }
          if (aHas && bHas && !propertySignatures[i](a[name], b[name])) {
            return false;
          }
        }
        for (let i = 0;i < indexSignatures.length; i++) {
          const is2 = ast.indexSignatures[i];
          const aKeys = getIndexSignatureKeys(a, is2.parameter);
          const bKeys = getIndexSignatureKeys(b, is2.parameter);
          if (aKeys.length !== bKeys.length)
            return false;
          for (let j = 0;j < aKeys.length; j++) {
            const key = aKeys[j];
            if (!Object.hasOwn(b, key) || !indexSignatures[i](a[key], b[key])) {
              return false;
            }
          }
        }
        return true;
      });
    }
    case "Union":
      return make2((a, b) => {
        const candidates = getCandidates(a, ast.types);
        const types = candidates.map(_is);
        for (let i = 0;i < candidates.length; i++) {
          const is2 = types[i];
          if (is2(a) && is2(b)) {
            return recur3(candidates[i], path)(a, b);
          }
        }
        return false;
      });
    case "Suspend": {
      const get3 = memoizeThunk(() => recur3(ast.thunk(), path));
      return make2((a, b) => get3()(a, b));
    }
  }
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/JsonPointer.js
function escapeToken(token) {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}
function unescapeToken(token) {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/RegExp.js
var RegExp2 = globalThis.RegExp;
var escape = (string3) => string3.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/schema/schema.js
var TypeId12 = "~effect/Schema/Schema";
var SchemaProto = {
  [TypeId12]: TypeId12,
  pipe() {
    return pipeArguments(this, arguments);
  },
  annotate(annotations) {
    return this.rebuild(annotate(this.ast, annotations));
  },
  annotateKey(annotations) {
    return this.rebuild(annotateKey(this.ast, annotations));
  },
  check(...checks) {
    return this.rebuild(appendChecks(this.ast, checks));
  }
};
function make16(ast, options) {
  const self = Object.create(SchemaProto);
  if (options) {
    Object.assign(self, options);
  }
  self.ast = ast;
  self.rebuild = (ast2) => make16(ast2, options);
  self.makeEffect = (input, options2) => mapSchemaIssueEffect2(makeEffect(self)(input, options2));
  self.make = make15(self);
  self.makeOption = makeOption(self);
  return self;
}
var SchemaErrorTypeId = "~effect/Schema/SchemaError";

class SchemaError extends (/* @__PURE__ */ TaggedError2("SchemaError")) {
  [SchemaErrorTypeId] = SchemaErrorTypeId;
  constructor(issue) {
    super({
      issue
    });
  }
  get message() {
    return this.issue.toString();
  }
  toString() {
    return `SchemaError(${this.message})`;
  }
}
function mapSchemaIssueEffect2(self) {
  return catchCause2(self, (cause) => failCauseSync2(() => map6(cause, (issue) => new SchemaError(issue))));
}
function mapSchemaErrorEffect(self) {
  return catchCause2(self, (cause) => failCauseSync2(() => map6(cause, (error) => error.issue)));
}
function mapSchemaIssueExit(exit3) {
  return isSuccess3(exit3) ? succeed4(exit3.value) : failCause2(map6(exit3.cause, (issue) => new SchemaError(issue)));
}
var jsonReorder = /* @__PURE__ */ makeReorder(getJsonPriority);
function getJsonPriority(ast) {
  switch (ast._tag) {
    case "BigInt":
    case "Symbol":
    case "UniqueSymbol":
      return 0;
    default:
      return 1;
  }
}
function makeReorder(getPriority) {
  return (types) => {
    const indexMap = new Map;
    for (let i = 0;i < types.length; i++) {
      indexMap.set(toEncoded(types[i]), i);
    }
    const sortedTypes = [...types].sort((a, b) => {
      a = toEncoded(a);
      b = toEncoded(b);
      const pa = getPriority(a);
      const pb = getPriority(b);
      if (pa !== pb)
        return pa - pb;
      return indexMap.get(a) - indexMap.get(b);
    });
    const orderChanged = sortedTypes.some((ast, index2) => ast !== types[index2]);
    if (!orderChanged)
      return types;
    return sortedTypes;
  };
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/internal/schema/representation.js
function fromAST(ast) {
  const {
    references,
    representations: schemas
  } = fromASTs([ast]);
  return {
    representation: schemas[0],
    references
  };
}
function fromASTs(asts) {
  const references = {};
  const referenceMap = new Map;
  const uniqueReferences = new Set;
  const visiting = new Set;
  const schemas = map4(asts, (ast) => recur4(ast));
  return {
    representations: schemas,
    references
  };
  function gen2(prefix) {
    let candidate = prefix;
    let suffix = 0;
    while (uniqueReferences.has(candidate)) {
      candidate = `${prefix}${++suffix}`;
    }
    uniqueReferences.add(candidate);
    return candidate;
  }
  function recur4(ast, prefix) {
    const found = referenceMap.get(ast);
    if (found !== undefined) {
      return {
        _tag: "Reference",
        $ref: found
      };
    }
    const last = getLastEncoding(ast);
    const identifier2 = resolveIdentifier(ast) ?? prefix;
    if (ast !== last) {
      return recur4(last, identifier2);
    }
    if (identifier2 !== undefined) {
      const reference = gen2(identifier2);
      referenceMap.set(ast, reference);
      const out2 = on(ast);
      const found2 = references[identifier2];
      if (found2 !== undefined && equals(out2, found2)) {
        referenceMap.set(ast, identifier2);
        return {
          _tag: "Reference",
          $ref: identifier2
        };
      }
      references[reference] = out2;
      return {
        _tag: "Reference",
        $ref: reference
      };
    }
    if (visiting.has(ast)) {
      const reference = gen2(`${ast._tag}_`);
      referenceMap.set(ast, reference);
      return {
        _tag: "Reference",
        $ref: reference
      };
    }
    visiting.add(ast);
    const out = on(ast);
    visiting.delete(ast);
    const ref = referenceMap.get(ast);
    if (ref !== undefined) {
      references[ref] = out;
      return {
        _tag: "Reference",
        $ref: ref
      };
    }
    return out;
  }
  function getEncodedSchema(last) {
    const getLink = last.annotations?.toCodecJson ?? last.annotations?.toCodec;
    if (isFunction(getLink)) {
      const tps = last.typeParameters.map((tp) => make16(toEncoded(tp)));
      const link = getLink(tps);
      return replaceEncoding(last, [link]);
    }
    return null_;
  }
  function on(last) {
    const annotations = fromASTAnnotations(last.annotations);
    switch (last._tag) {
      case "Declaration": {
        const encodedSchema = recur4(getEncodedSchema(last));
        return {
          _tag: "Declaration",
          typeParameters: last.typeParameters.map((ast) => recur4(ast)),
          encodedSchema,
          checks: fromASTChecks(last.checks),
          ...annotations
        };
      }
      case "Null":
      case "Undefined":
      case "Void":
      case "Never":
      case "Unknown":
      case "Any":
      case "Boolean":
      case "Symbol":
      case "ObjectKeyword":
        return {
          _tag: last._tag,
          ...annotations
        };
      case "String": {
        const contentMediaType = last.annotations?.contentMediaType;
        const contentSchema = last.annotations?.contentSchema;
        return {
          _tag: last._tag,
          checks: fromASTChecks(last.checks),
          ...annotations,
          ...typeof contentMediaType === "string" && isAST(contentSchema) ? {
            contentSchema: recur4(contentSchema)
          } : undefined
        };
      }
      case "Number":
      case "BigInt":
        return {
          _tag: last._tag,
          checks: fromASTChecks(last.checks),
          ...annotations
        };
      case "Literal":
        return {
          _tag: last._tag,
          literal: last.literal,
          ...annotations
        };
      case "UniqueSymbol":
        return {
          _tag: last._tag,
          symbol: last.symbol,
          ...annotations
        };
      case "Enum":
        return {
          _tag: last._tag,
          enums: last.enums,
          ...annotations
        };
      case "TemplateLiteral":
        return {
          _tag: last._tag,
          parts: last.parts.map((ast) => recur4(ast)),
          ...annotations
        };
      case "Arrays":
        return {
          _tag: last._tag,
          elements: last.elements.map((e) => {
            const last2 = getLastEncoding(e);
            return {
              isOptional: isOptional(last2),
              type: recur4(e),
              ...fromASTAnnotations(last2.context?.annotations)
            };
          }),
          rest: last.rest.map((ast) => recur4(ast)),
          checks: fromASTChecks(last.checks),
          ...annotations
        };
      case "Objects":
        return {
          _tag: last._tag,
          propertySignatures: last.propertySignatures.map((ps) => {
            const last2 = getLastEncoding(ps.type);
            return {
              name: ps.name,
              type: recur4(ps.type),
              isOptional: isOptional(last2),
              isMutable: isMutable(last2),
              ...fromASTAnnotations(last2.context?.annotations)
            };
          }),
          indexSignatures: last.indexSignatures.map((is2) => ({
            parameter: recur4(is2.parameter),
            type: recur4(is2.type)
          })),
          checks: fromASTChecks(last.checks),
          ...annotations
        };
      case "Union": {
        const types = jsonReorder(last.types);
        return {
          _tag: last._tag,
          types: types.map((ast) => recur4(ast)),
          mode: last.mode,
          ...annotations
        };
      }
      case "Suspend": {
        return {
          _tag: "Suspend",
          checks: [],
          thunk: recur4(last.thunk()),
          ...annotations
        };
      }
    }
  }
  function fromASTChecks(checks) {
    if (!checks)
      return [];
    return checks.map(getCheck).filter((c) => c !== undefined);
    function getCheck(c) {
      switch (c._tag) {
        case "Filter": {
          const meta = c.annotations?.meta;
          if (meta) {
            return {
              _tag: "Filter",
              meta: meta._tag === "isPropertyNames" ? {
                _tag: "isPropertyNames",
                propertyNames: recur4(meta.propertyNames)
              } : meta,
              ...fromASTAnnotations(c.annotations)
            };
          }
          return;
        }
        case "FilterGroup": {
          const checks2 = fromASTChecks(c.checks);
          if (isArrayNonEmpty2(checks2)) {
            return {
              _tag: "FilterGroup",
              checks: checks2,
              ...fromASTAnnotations(c.annotations)
            };
          }
        }
      }
    }
  }
}
var fromASTBlacklist = /* @__PURE__ */ new Set([
  "~structural",
  "~sentinels",
  "meta",
  "arbitrary",
  "toArbitrary",
  "toEquivalence",
  "toFormatter",
  "toCodec",
  "toCodecJson",
  "toCodecIso",
  ClassTypeId
]);
var standardJsonSchemaAnnotationKeys = /* @__PURE__ */ new Set(["title", "description", "default", "examples", "readOnly", "writeOnly", "format", "contentEncoding", "contentMediaType", "contentSchema"]);
function fromASTAnnotations(annotations) {
  if (annotations !== undefined) {
    const filtered = filter2(annotations, (_, k) => !fromASTBlacklist.has(k));
    if (!isEmptyRecord(filtered)) {
      return {
        annotations: filtered
      };
    }
  }
  return;
}
function toJsonSchemaDocument(document, options) {
  const {
    definitions,
    dialect: source,
    schemas
  } = toJsonSchemaMultiDocument({
    representations: [document.representation],
    references: document.references
  }, options);
  const schema = schemas[0];
  return {
    dialect: source,
    schema,
    definitions
  };
}
function toJsonSchemaMultiDocument(multiDocument, options) {
  const generateDescriptions = options?.generateDescriptions ?? false;
  const additionalProperties = options?.additionalProperties ?? false;
  const includeAnnotationKey = options?.includeAnnotationKey;
  const definitions = map3(multiDocument.references, (d) => recur4(d));
  return {
    dialect: "draft-2020-12",
    schemas: map4(multiDocument.representations, (s) => recur4(s)),
    definitions
  };
  function recur4(s) {
    let js = on(s);
    if ("annotations" in s) {
      const a = collectJsonSchemaAnnotations(s.annotations);
      if (a) {
        js = {
          ...js,
          ...a
        };
      }
    }
    if ("checks" in s) {
      const checks = collectJsonSchemaChecks(s.checks, js.type);
      for (const check of checks) {
        js = appendJsonSchema(js, check);
      }
    }
    return js;
  }
  function on(schema) {
    switch (schema._tag) {
      case "Any":
      case "Unknown":
        return {};
      case "ObjectKeyword":
        return {
          anyOf: [{
            type: "object"
          }, {
            type: "array"
          }]
        };
      case "Void":
      case "Undefined":
        return {
          type: "null"
        };
      case "BigInt":
        return {
          type: "string",
          allOf: [{
            pattern: "^-?\\d+$"
          }]
        };
      case "Symbol":
      case "UniqueSymbol":
        return {
          type: "string",
          allOf: [{
            pattern: "^Symbol\\((.*)\\)$"
          }]
        };
      case "Declaration":
        return recur4(schema.encodedSchema);
      case "Suspend":
        return recur4(schema.thunk);
      case "Reference":
        return {
          $ref: `#/$defs/${escapeToken(schema.$ref)}`
        };
      case "Null":
        return {
          type: "null"
        };
      case "Never":
        return {
          not: {}
        };
      case "String": {
        const out = {
          type: "string"
        };
        if (schema.contentMediaType !== undefined) {
          out.contentMediaType = schema.contentMediaType;
        }
        if (schema.contentSchema !== undefined) {
          out.contentSchema = recur4(schema.contentSchema);
        }
        return out;
      }
      case "Number":
        return hasCheck2(schema.checks, "isInt") ? {
          type: "integer"
        } : hasCheck2(schema.checks, "isFinite") ? {
          type: "number"
        } : {
          anyOf: [{
            type: "number"
          }, {
            type: "string",
            enum: ["NaN"]
          }, {
            type: "string",
            enum: ["Infinity"]
          }, {
            type: "string",
            enum: ["-Infinity"]
          }]
        };
      case "Boolean":
        return {
          type: "boolean"
        };
      case "Literal": {
        const literal = schema.literal;
        if (typeof literal === "string") {
          return {
            type: "string",
            enum: [literal]
          };
        }
        if (typeof literal === "number") {
          return {
            type: "number",
            enum: [literal]
          };
        }
        if (typeof literal === "boolean") {
          return {
            type: "boolean",
            enum: [literal]
          };
        }
        return {
          type: "string",
          enum: [String(literal)]
        };
      }
      case "Enum": {
        return recur4({
          _tag: "Union",
          types: schema.enums.map(([title, value3]) => ({
            _tag: "Literal",
            literal: value3,
            annotations: {
              title
            }
          })),
          mode: "anyOf",
          annotations: schema.annotations
        });
      }
      case "TemplateLiteral": {
        const pattern = schema.parts.map(getPartPattern).join("");
        return {
          type: "string",
          pattern: `^${pattern}$`
        };
      }
      case "Arrays": {
        if (schema.rest.length > 1) {
          throw new globalThis.Error("Generating a JSON Schema for post-rest elements is not supported");
        }
        const out = {
          type: "array"
        };
        let minItems = schema.elements.length;
        const prefixItems = schema.elements.map((e) => {
          if (e.isOptional) {
            minItems--;
          }
          const v = recur4(e.type);
          const a = collectJsonSchemaAnnotations(e.annotations);
          return a ? appendJsonSchema(v, a) : v;
        });
        if (prefixItems.length > 0) {
          out.prefixItems = prefixItems;
          out.maxItems = schema.elements.length;
          if (minItems > 0) {
            out.minItems = minItems;
          }
        } else {
          out.items = false;
        }
        if (schema.rest.length > 0) {
          delete out.maxItems;
          const rest = recur4(schema.rest[0]);
          if (Object.keys(rest).length > 0) {
            out.items = rest;
          } else {
            delete out.items;
          }
        }
        return out;
      }
      case "Objects": {
        if (schema.propertySignatures.length === 0 && schema.indexSignatures.length === 0) {
          return {
            anyOf: [{
              type: "object"
            }, {
              type: "array"
            }]
          };
        }
        const out = {
          type: "object"
        };
        const properties = {};
        const required = [];
        for (const ps of schema.propertySignatures) {
          const name = ps.name;
          if (typeof name !== "string") {
            throw new globalThis.Error(`Unsupported property signature name: ${format(name)}`);
          }
          const v = recur4(ps.type);
          const a = collectJsonSchemaAnnotations(ps.annotations);
          properties[name] = a ? appendJsonSchema(v, a) : v;
          if (!ps.isOptional) {
            required.push(name);
          }
        }
        if (Object.keys(properties).length > 0) {
          out.properties = properties;
        }
        if (required.length > 0) {
          out.required = required;
        }
        out.additionalProperties = additionalProperties;
        const patternProperties = {};
        for (const is2 of schema.indexSignatures) {
          let type = recur4(is2.type);
          if (Object.keys(type).length === 1 && "not" in type) {
            type = false;
          }
          const patterns = getParameterPatterns(is2.parameter);
          if (patterns.length > 0) {
            for (const pattern of patterns) {
              patternProperties[pattern] = type;
            }
          } else {
            out.additionalProperties = type;
          }
        }
        if (Object.keys(patternProperties).length > 0) {
          out.patternProperties = patternProperties;
          delete out.additionalProperties;
        }
        if (isObject(out.additionalProperties) && isEmptyRecord(out.additionalProperties)) {
          delete out.additionalProperties;
        }
        return out;
      }
      case "Union": {
        const types = schema.types.map(recur4);
        if (types.length === 0) {
          return {
            not: {}
          };
        }
        if (types.length > 1) {
          const compacted = compactEnums(types);
          if (compacted)
            return compacted;
        }
        return schema.mode === "anyOf" ? {
          anyOf: types
        } : {
          oneOf: types
        };
      }
    }
  }
  function compactEnums(types) {
    let sharedType;
    const values2 = [];
    for (const t of types) {
      const keys3 = Object.keys(t);
      if (keys3.length !== 2 || t.type === undefined || !Array.isArray(t.enum) || t.enum.length === 0) {
        return;
      }
      if (sharedType === undefined) {
        sharedType = t.type;
      } else if (t.type !== sharedType) {
        return;
      }
      for (const v of t.enum) {
        values2.push(v);
      }
    }
    return {
      type: sharedType,
      enum: values2
    };
  }
  function collectJsonSchemaAnnotations(annotations) {
    if (annotations === undefined)
      return;
    const out = {};
    if (typeof annotations.title === "string")
      out.title = annotations.title;
    if (typeof annotations.description === "string")
      out.description = annotations.description;
    else if (generateDescriptions && typeof annotations.expected === "string")
      out.description = annotations.expected;
    if (annotations.default !== undefined)
      out.default = annotations.default;
    if (Array.isArray(annotations.examples))
      out.examples = annotations.examples;
    if (typeof annotations.readOnly === "boolean")
      out.readOnly = annotations.readOnly;
    if (typeof annotations.writeOnly === "boolean")
      out.writeOnly = annotations.writeOnly;
    if (typeof annotations.format === "string")
      out.format = annotations.format;
    if (typeof annotations.contentEncoding === "string")
      out.contentEncoding = annotations.contentEncoding;
    if (typeof annotations.contentMediaType === "string")
      out.contentMediaType = annotations.contentMediaType;
    if (includeAnnotationKey) {
      for (const [key, value3] of Object.entries(annotations)) {
        if (value3 === undefined)
          continue;
        if (standardJsonSchemaAnnotationKeys.has(key))
          continue;
        if (!includeAnnotationKey(key))
          continue;
        out[key] = value3;
      }
    }
    if (Object.keys(out).length > 0)
      return out;
  }
  function collectJsonSchemaChecks(checks, type) {
    return checks.map(collectJsonSchemaCheck).filter((c) => c !== undefined);
    function collectJsonSchemaCheck(check) {
      switch (check._tag) {
        case "Filter":
          return filterToJsonSchema(check, type);
        case "FilterGroup": {
          const checks2 = check.checks.map(collectJsonSchemaCheck).filter((c) => c !== undefined);
          if (checks2.length === 0)
            return;
          let out = {
            allOf: checks2
          };
          const a = collectJsonSchemaAnnotations(check.annotations);
          if (a) {
            out = {
              ...out,
              ...a
            };
          }
          return out;
        }
      }
    }
  }
  function filterToJsonSchema(filter7, type) {
    const meta = filter7.meta;
    if (!meta)
      return;
    let out = on2(meta);
    const a = collectJsonSchemaAnnotations(filter7.annotations);
    if (a) {
      out = {
        ...out,
        ...a
      };
    }
    return out;
    function on2(meta2) {
      switch (meta2._tag) {
        case "isMinLength":
          return type === "array" ? {
            minItems: meta2.minLength
          } : {
            minLength: meta2.minLength
          };
        case "isMaxLength":
          return type === "array" ? {
            maxItems: meta2.maxLength
          } : {
            maxLength: meta2.maxLength
          };
        case "isLengthBetween":
          return type === "array" ? {
            allOf: [{
              minItems: meta2.minimum
            }, {
              maxItems: meta2.maximum
            }]
          } : {
            allOf: [{
              minLength: meta2.minimum
            }, {
              maxLength: meta2.maximum
            }]
          };
        case "isPattern":
        case "isGUID":
        case "isULID":
        case "isBase64":
        case "isBase64Url":
        case "isStartsWith":
        case "isEndsWith":
        case "isIncludes":
        case "isUppercased":
        case "isLowercased":
        case "isCapitalized":
        case "isUncapitalized":
        case "isTrimmed":
        case "isStringFinite":
        case "isStringBigInt":
        case "isStringSymbol":
          return {
            pattern: meta2.regExp.source
          };
        case "isUUID":
          return {
            pattern: meta2.regExp.source,
            format: "uuid"
          };
        case "isFinite":
        case "isInt":
          return;
        case "isMultipleOf":
          return {
            multipleOf: meta2.divisor
          };
        case "isGreaterThanOrEqualTo":
          return {
            minimum: meta2.minimum
          };
        case "isLessThanOrEqualTo":
          return {
            maximum: meta2.maximum
          };
        case "isGreaterThan":
          return {
            exclusiveMinimum: meta2.exclusiveMinimum
          };
        case "isLessThan":
          return {
            exclusiveMaximum: meta2.exclusiveMaximum
          };
        case "isBetween": {
          return {
            [meta2.exclusiveMinimum ? "exclusiveMinimum" : "minimum"]: meta2.minimum,
            [meta2.exclusiveMaximum ? "exclusiveMaximum" : "maximum"]: meta2.maximum
          };
        }
        case "isUnique":
          return {
            uniqueItems: true
          };
        case "isMinProperties":
          return {
            minProperties: meta2.minProperties
          };
        case "isMaxProperties":
          return {
            maxProperties: meta2.maxProperties
          };
        case "isPropertiesLengthBetween":
          return {
            minProperties: meta2.minimum,
            maxProperties: meta2.maximum
          };
        case "isPropertyNames":
          return {
            propertyNames: recur4(meta2.propertyNames)
          };
        case "isDateValid":
          return {
            format: "date-time"
          };
      }
    }
  }
  function getParameterPatterns(parameter) {
    switch (parameter._tag) {
      default:
        throw new globalThis.Error(`Unsupported index signature parameter: ${parameter._tag}`);
      case "Reference":
        return getParameterPatterns(multiDocument.references[parameter.$ref]);
      case "String":
        return getPatterns(parameter);
      case "TemplateLiteral":
        return [`^${parameter.parts.map(getPartPattern).join("")}$`];
      case "Union":
        return parameter.types.flatMap(getParameterPatterns);
    }
  }
}
function getPatterns(s) {
  return recur4(s.checks);
  function recur4(checks) {
    return checks.flatMap((c) => {
      switch (c._tag) {
        case "Filter": {
          if ("regExp" in c.meta) {
            return [c.meta.regExp.source];
          }
          return [];
        }
        case "FilterGroup":
          return recur4(c.checks);
      }
    });
  }
}
function hasCheck2(checks, tag) {
  return checks.some((c) => {
    switch (c._tag) {
      case "Filter":
        return c.meta._tag === tag;
      case "FilterGroup":
        return hasCheck2(c.checks, tag);
    }
  });
}
function appendJsonSchema(a, b) {
  if (Object.keys(a).length === 0)
    return b;
  const len = Object.keys(b).length;
  if (len === 0)
    return a;
  const members = Array.isArray(b.allOf) && len === 1 ? b.allOf : [b];
  if (Array.isArray(a.allOf)) {
    return {
      ...a,
      allOf: [...a.allOf, ...members]
    };
  }
  if (typeof a.$ref === "string") {
    return {
      allOf: [a, ...members]
    };
  }
  return {
    ...a,
    allOf: members
  };
}
function getPartPattern(part) {
  switch (part._tag) {
    case "Literal":
      return escape(globalThis.String(part.literal));
    case "String":
      return STRING_PATTERN;
    case "Number":
      return FINITE_PATTERN;
    case "TemplateLiteral":
      return part.parts.map(getPartPattern).join("");
    case "Union":
      return part.types.map(getPartPattern).join("|");
    default:
      throw new globalThis.Error("Unsupported part", {
        cause: part
      });
  }
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/JsonPatch.js
function get3(oldValue, newValue) {
  if (Object.is(oldValue, newValue))
    return [];
  const patches = [];
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    const len1 = oldValue.length;
    const len2 = newValue.length;
    const shared = Math.min(len1, len2);
    for (let i = 0;i < shared; i++) {
      const path = `/${i}`;
      const patch = get3(oldValue[i], newValue[i]);
      for (const op of patch) {
        prefixPathInPlace(op, path);
        patches.push(op);
      }
    }
    for (let i = len1 - 1;i >= len2; i--) {
      patches.push({
        op: "remove",
        path: `/${i}`
      });
    }
    for (let i = len1;i < len2; i++) {
      patches.push({
        op: "add",
        path: `/${i}`,
        value: newValue[i]
      });
    }
    return patches;
  }
  if (isJsonObject(oldValue) && isJsonObject(newValue)) {
    const keys1 = Object.keys(oldValue);
    const keys22 = Object.keys(newValue);
    const allKeys = Array.from(new Set([...keys1, ...keys22])).sort();
    for (const key of allKeys) {
      const esc = escapeToken(key);
      const path = `/${esc}`;
      const hasKey1 = Object.hasOwn(oldValue, key);
      const hasKey2 = Object.hasOwn(newValue, key);
      if (hasKey1 && hasKey2) {
        const patch = get3(oldValue[key], newValue[key]);
        for (const op of patch) {
          prefixPathInPlace(op, path);
          patches.push(op);
        }
      } else if (!hasKey1 && hasKey2) {
        patches.push({
          op: "add",
          path,
          value: newValue[key]
        });
      } else if (hasKey1 && !hasKey2) {
        patches.push({
          op: "remove",
          path
        });
      }
    }
    return patches;
  }
  patches.push({
    op: "replace",
    path: "",
    value: newValue
  });
  return patches;
}
function apply(patch, oldValue) {
  let doc = oldValue;
  for (const op of patch) {
    switch (op.op) {
      case "replace": {
        doc = op.path === "" ? op.value : setAt(doc, op.path, op.value, "replace");
        break;
      }
      case "add": {
        doc = addAt(doc, op.path, op.value);
        break;
      }
      case "remove": {
        doc = setAt(doc, op.path, undefined, "remove");
        break;
      }
    }
  }
  return doc;
}
function prefixPathInPlace(op, parent) {
  op.path = op.path === "" ? parent : parent + op.path;
}
function isJsonObject(value3) {
  return isObject(value3);
}
function tokenize(pointer) {
  if (pointer === "")
    return [];
  if (pointer.charCodeAt(0) !== 47) {
    throw new Error(`Invalid JSON Pointer, it must start with "/": ${format(pointer)}`);
  }
  return pointer.split("/").slice(1).map(unescapeToken);
}
function toIndex(token) {
  if (!/^(0|[1-9]\d*)$/.test(token)) {
    throw new Error(`Invalid array index: "${token}"`);
  }
  return Number(token);
}
function addAt(doc, pointer, val) {
  if (pointer === "")
    return val;
  const resolved = resolveParent(doc, pointer);
  if (resolved === null) {
    throw new Error(`Cannot add at "${pointer}" (parent not found or not a container).`);
  }
  const {
    lastToken,
    parent,
    stack
  } = resolved;
  if (Array.isArray(parent)) {
    const idx = lastToken === "-" ? parent.length : toIndex(lastToken);
    if (idx < 0 || idx > parent.length)
      throw new Error(`Array index out of bounds at "${pointer}".`);
    const updated = parent.slice();
    updated.splice(idx, 0, val);
    return rebuildFromStack(stack, updated);
  }
  if (isJsonObject(parent)) {
    const updated = {
      ...parent
    };
    updated[lastToken] = val;
    return rebuildFromStack(stack, updated);
  }
  throw new Error(`Cannot add at "${pointer}" (parent not found or not a container).`);
}
function setAt(doc, pointer, val, mode) {
  if (pointer === "") {
    if (mode === "remove" || val === undefined)
      throw new Error("Unsupported operation at the root");
    return val;
  }
  const resolved = resolveParent(doc, pointer);
  if (resolved === null) {
    throw new Error(`Cannot ${mode} at "${pointer}" (parent not found or not a container).`);
  }
  const {
    lastToken,
    parent,
    stack
  } = resolved;
  if (Array.isArray(parent)) {
    if (lastToken === "-")
      throw new Error(`"-" is not valid for ${mode} at "${pointer}".`);
    const idx = toIndex(lastToken);
    if (idx < 0 || idx >= parent.length)
      throw new Error(`Array index out of bounds at "${pointer}".`);
    const updated = parent.slice();
    if (mode === "remove")
      updated.splice(idx, 1);
    else
      updated[idx] = val;
    return rebuildFromStack(stack, updated);
  }
  if (isJsonObject(parent)) {
    if (!Object.hasOwn(parent, lastToken)) {
      throw new Error(`Property "${lastToken}" does not exist at "${pointer}".`);
    }
    const updated = {
      ...parent
    };
    if (mode === "remove")
      delete updated[lastToken];
    else
      updated[lastToken] = val;
    return rebuildFromStack(stack, updated);
  }
  throw new Error(`Cannot ${mode} at "${pointer}" (parent not found or not a container).`);
}
function resolveParent(doc, pointer) {
  const tokens = tokenize(pointer);
  if (tokens.length === 0)
    return null;
  const lastToken = tokens[tokens.length - 1];
  const stack = [];
  let cur = doc;
  for (let i = 0;i < tokens.length - 1; i++) {
    const token = tokens[i];
    if (cur == null)
      return null;
    if (Array.isArray(cur)) {
      const idx = toIndex(token);
      if (idx < 0 || idx >= cur.length)
        return null;
      stack.push({
        container: cur,
        token: idx
      });
      cur = cur[idx];
      continue;
    }
    if (cur && typeof cur === "object") {
      if (!Object.hasOwn(cur, token))
        return null;
      stack.push({
        container: cur,
        token
      });
      cur = cur[token];
      continue;
    }
    return null;
  }
  return {
    stack,
    parent: cur,
    lastToken
  };
}
function rebuildFromStack(stack, newParent) {
  let acc = newParent;
  for (let i = stack.length - 1;i >= 0; i--) {
    const {
      container,
      token
    } = stack[i];
    if (Array.isArray(container)) {
      const copy2 = container.slice();
      copy2[token] = acc;
      acc = copy2;
    } else {
      const copy2 = {
        ...container
      };
      copy2[token] = acc;
      acc = copy2;
    }
  }
  return acc;
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/JsonSchema.js
var RE_DEFS = /^#\/\$defs(?=\/|$)/;
function toDocumentDraft07(document) {
  return {
    dialect: "draft-07",
    schema: toSchemaDraft07(document.schema),
    definitions: map3(document.definitions, toSchemaDraft07)
  };
}
function toSchemaDraft07(schema) {
  return rewrite(schema);
  function rewrite(node) {
    return walk(rewrite_refs(node, (ref) => ref.replace(RE_DEFS, "#/definitions")), true);
  }
  function walk(node, _isRoot) {
    if (Array.isArray(node))
      return node.map((v) => walk(v, false));
    if (!isObject(node))
      return node;
    const src = node;
    const out = {};
    let prefixItems = undefined;
    let items = undefined;
    for (const k of Object.keys(src)) {
      const v = src[k];
      switch (k) {
        case "$ref":
        case "type":
        case "required":
        case "enum":
        case "const":
        case "title":
        case "description":
        case "default":
        case "examples":
        case "format":
        case "pattern":
        case "minimum":
        case "maximum":
        case "exclusiveMinimum":
        case "exclusiveMaximum":
        case "minLength":
        case "maxLength":
        case "minItems":
        case "maxItems":
        case "minProperties":
        case "maxProperties":
        case "multipleOf":
        case "uniqueItems":
          out[k] = v;
          break;
        case "properties":
        case "patternProperties": {
          const mapped = walk_object(v, walk);
          out[k] = mapped ?? v;
          break;
        }
        case "additionalProperties":
        case "propertyNames":
          out[k] = walk(v, false);
          break;
        case "allOf":
        case "anyOf":
        case "oneOf":
          out[k] = Array.isArray(v) ? v.map((x) => walk(x, false)) : v;
          break;
        case "prefixItems":
          prefixItems = v;
          break;
        case "items":
          items = v;
          break;
        default:
          break;
      }
    }
    if (prefixItems !== undefined) {
      if (Array.isArray(prefixItems)) {
        out.items = prefixItems.map((x) => walk(x, false));
        if (items !== undefined)
          out.additionalItems = walk(items, false);
      } else {
        out.items = walk(prefixItems, false);
      }
    } else if (items !== undefined) {
      out.items = walk(items, false);
    }
    return out;
  }
}
function rewrite_refs(node, f) {
  if (Array.isArray(node))
    return node.map((v) => rewrite_refs(v, f));
  if (!isObject(node))
    return node;
  const out = {};
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (k === "$ref") {
      out[k] = typeof v === "string" ? f(v) : v;
    } else if (Array.isArray(v) || isObject(v)) {
      out[k] = rewrite_refs(v, f);
    } else {
      out[k] = v;
    }
  }
  return out;
}
function walk_object(value3, walk) {
  if (!isObject(value3))
    return;
  const out = {};
  for (const k of Object.keys(value3))
    out[k] = walk(value3[k], false);
  return out;
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Optic.js
function makeIso(get4, set3) {
  return make17(new IsoNode(get4, set3));
}
function makeLens(get4, replace) {
  return make17(new LensNode(get4, replace));
}
class IdentityNode {
  _tag = "IdentityNode";
}
var identityNode = /* @__PURE__ */ new IdentityNode;

class CompositionNode {
  _tag = "CompositionNode";
  nodes;
  constructor(nodes) {
    this.nodes = nodes;
  }
}

class IsoNode {
  _tag = "IsoNode";
  get;
  set;
  constructor(get4, set3) {
    this.get = get4;
    this.set = set3;
  }
}

class LensNode {
  _tag = "LensNode";
  get;
  set;
  constructor(get4, set3) {
    this.get = get4;
    this.set = set3;
  }
}

class PrismNode {
  _tag = "PrismNode";
  get;
  set;
  constructor(get4, set3) {
    this.get = get4;
    this.set = set3;
  }
}

class OptionalNode {
  _tag = "OptionalNode";
  get;
  set;
  constructor(get4, set3) {
    this.get = get4;
    this.set = set3;
  }
}

class PathNode {
  _tag = "PathNode";
  path;
  constructor(path) {
    this.path = path;
  }
}

class CheckNode {
  _tag = "CheckNode";
  checks;
  constructor(checks) {
    this.checks = checks;
  }
}
function pushNormalized(acc, node) {
  const last = acc[acc.length - 1];
  if (last) {
    if (last._tag === "PathNode" && node._tag === "PathNode") {
      acc[acc.length - 1] = new PathNode([...last.path, ...node.path]);
      return;
    }
    if (last._tag === "CheckNode" && node._tag === "CheckNode") {
      acc[acc.length - 1] = new CheckNode([...last.checks, ...node.checks]);
      return;
    }
  }
  acc.push(node);
}
function collect(node, acc) {
  if (node._tag === "IdentityNode")
    return;
  if (node._tag === "CompositionNode") {
    for (let i = 0;i < node.nodes.length; i++)
      collect(node.nodes[i], acc);
    return;
  }
  pushNormalized(acc, node);
}
function compose(a, b) {
  const nodes = [];
  collect(a, nodes);
  collect(b, nodes);
  switch (nodes.length) {
    case 0:
      return identityNode;
    case 1:
      return nodes[0];
    default:
      return new CompositionNode(nodes);
  }
}
function makeOptional(getResult, set3) {
  return make17(new OptionalNode(getResult, set3));
}

class OptionalImpl {
  node;
  getResult;
  replaceResult;
  constructor(node, getResult, replaceResult) {
    this.node = node;
    this.getResult = getResult;
    this.replaceResult = replaceResult;
  }
  replace(a, s) {
    return getOrElse2(this.replaceResult(a, s), () => s);
  }
  modify(f) {
    return (s) => getOrElse2(flatMap2(this.getResult(s), (a) => this.replaceResult(f(a), s)), () => s);
  }
  compose(that) {
    return make17(compose(this.node, that.node));
  }
  key(key) {
    return make17(compose(this.node, new PathNode([key])));
  }
  optionalKey(key) {
    return make17(compose(this.node, new LensNode((s) => s[key], (a, s) => {
      const copy2 = cloneShallow(s);
      if (a === undefined) {
        if (Array.isArray(copy2) && typeof key === "number") {
          copy2.splice(key, 1);
        } else {
          delete copy2[key];
        }
      } else {
        copy2[key] = a;
      }
      return copy2;
    })));
  }
  check(...checks) {
    return make17(compose(this.node, new CheckNode(checks)));
  }
  refine(refinement, annotations) {
    return make17(compose(this.node, new CheckNode([makeFilterByGuard(refinement, annotations)])));
  }
  tag(tag) {
    return make17(compose(this.node, new PrismNode((s) => s._tag === tag ? succeed2(s) : fail2(`Expected ${format(tag)} tag, got ${format(s._tag)}`), identity)));
  }
  at(key, ..._rest) {
    const err = fail2(`Key ${format(key)} not found`);
    return make17(compose(this.node, new OptionalNode((s) => Object.hasOwn(s, key) ? succeed2(s[key]) : err, (a, s) => {
      if (Object.hasOwn(s, key)) {
        const copy2 = cloneShallow(s);
        copy2[key] = a;
        return succeed2(copy2);
      } else {
        return err;
      }
    })));
  }
  pick(keys3) {
    return this.compose(makeLens(pick(keys3), (p, a) => ({
      ...a,
      ...p
    })));
  }
  omit(keys3) {
    return this.compose(makeLens(omit2(keys3), (o, a) => ({
      ...a,
      ...o
    })));
  }
  notUndefined() {
    return this.refine(isNotUndefined, {
      expected: "a value other than `undefined`"
    });
  }
  forEach(f) {
    const inner = f(id());
    return makeOptional((s) => map2(this.getResult(s), (as2) => {
      const bs = [];
      for (let i = 0;i < as2.length; i++) {
        const r = inner.getResult(as2[i]);
        if (isSuccess2(r))
          bs.push(r.success);
      }
      return bs;
    }), (bs, s) => flatMap2(this.getResult(s), (as2) => {
      const idxs = [];
      for (let i = 0;i < as2.length; i++) {
        if (isSuccess2(inner.getResult(as2[i])))
          idxs.push(i);
      }
      if (bs.length !== idxs.length) {
        return fail2(`each: replacement length mismatch: ${bs.length} !== ${idxs.length}`);
      }
      const out = as2.slice();
      for (let k = 0;k < idxs.length; k++) {
        const i = idxs[k];
        const r = inner.replaceResult(bs[k], as2[i]);
        if (isFailure2(r)) {
          return fail2(`each: could not set element ${i}`);
        }
        out[i] = r.success;
      }
      return this.replaceResult(out, s);
    }));
  }
  modifyAll(f) {
    return (s) => getOrElse2(flatMap2(this.getResult(s), (as2) => this.replaceResult(as2.map(f), s)), () => s);
  }
}

class IsoImpl extends OptionalImpl {
  get;
  set;
  constructor(node, get4, set3) {
    super(node, (s) => succeed2(get4(s)), (a) => succeed2(set3(a)));
    this.get = get4;
    this.set = set3;
  }
  replace(a, _) {
    return this.set(a);
  }
  modify(f) {
    return (s) => this.set(f(this.get(s)));
  }
}

class LensImpl extends OptionalImpl {
  get;
  constructor(node, get4, replace) {
    super(node, (s) => succeed2(get4(s)), (a, s) => succeed2(replace(a, s)));
    this.get = get4;
    this.replace = replace;
  }
  modify(f) {
    return (s) => this.replace(f(this.get(s)), s);
  }
}

class PrismImpl extends OptionalImpl {
  set;
  constructor(node, getResult, set3) {
    super(node, getResult, (a, _) => succeed2(set3(a)));
    this.set = set3;
  }
  replace(a, _) {
    return this.set(a);
  }
  modify(f) {
    return (s) => getOrElse2(map2(this.getResult(s), (a) => this.set(f(a))), () => s);
  }
}
function make17(node) {
  const op = recur4(node);
  switch (op._tag) {
    case "IsoNode":
      return new IsoImpl(node, op.get, op.set);
    case "LensNode":
      return new LensImpl(node, op.get, op.set);
    case "PrismNode":
      return new PrismImpl(node, op.get, op.set);
    case "OptionalNode":
      return new OptionalImpl(node, op.get, op.set);
  }
}
function cloneShallow(pojo) {
  if (Array.isArray(pojo))
    return pojo.slice();
  if (typeof pojo === "object" && pojo !== null) {
    const proto = Object.getPrototypeOf(pojo);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error("Cannot clone object with non-Object constructor or null prototype");
    }
    return {
      ...pojo
    };
  }
  return pojo;
}
var recur4 = /* @__PURE__ */ memoize((node) => {
  switch (node._tag) {
    case "IdentityNode":
      return {
        _tag: "IsoNode",
        get: identity,
        set: identity
      };
    case "IsoNode":
    case "LensNode":
    case "PrismNode":
    case "OptionalNode":
      return {
        _tag: node._tag,
        get: node.get,
        set: node.set
      };
    case "PathNode": {
      return {
        _tag: "LensNode",
        get: (s) => {
          const path = node.path;
          let out = s;
          for (let i = 0, n = path.length;i < n; i++) {
            out = out[path[i]];
          }
          return out;
        },
        set: (a, s) => {
          const path = node.path;
          const out = cloneShallow(s);
          let current = out;
          let i = 0;
          for (;i < path.length - 1; i++) {
            const key = path[i];
            current[key] = cloneShallow(current[key]);
            current = current[key];
          }
          const finalKey = path[i];
          current[finalKey] = a;
          return out;
        }
      };
    }
    case "CheckNode":
      return {
        _tag: "PrismNode",
        get: (s) => mapError(runChecks(node.checks, s), String),
        set: identity
      };
    case "CompositionNode": {
      const ops = node.nodes.map(recur4);
      const _tag = ops.reduce((tag, op) => getCompositionTag(tag, op._tag), "IsoNode");
      return {
        _tag,
        get: (s) => {
          for (let i = 0;i < ops.length; i++) {
            const op = ops[i];
            const result2 = op.get(s);
            if (hasFailingGet(op._tag)) {
              if (isFailure2(result2)) {
                return result2;
              }
              s = result2.success;
            } else {
              s = result2;
            }
          }
          return hasFailingGet(_tag) ? succeed2(s) : s;
        },
        set: (a, s) => {
          const source = s;
          const len = ops.length;
          const ss = new Array(len + 1);
          ss[0] = s;
          for (let i = 0;i < len; i++) {
            const op = ops[i];
            if (hasFailingGet(op._tag)) {
              const result2 = op.get(s);
              if (isFailure2(result2)) {
                return _tag === "OptionalNode" ? result2 : source;
              }
              s = result2.success;
            } else {
              s = op.get(s);
            }
            ss[i + 1] = s;
          }
          for (let i = len - 1;i >= 0; i--) {
            const op = ops[i];
            if (hasSet(op._tag)) {
              a = op.set(a);
            } else if (op._tag === "LensNode") {
              a = op.set(a, ss[i]);
            } else {
              const result2 = op.set(a, ss[i]);
              if (isFailure2(result2)) {
                return result2;
              }
              a = result2.success;
            }
          }
          return _tag === "OptionalNode" ? succeed2(a) : a;
        }
      };
    }
  }
});
function hasFailingGet(tag) {
  return tag === "PrismNode" || tag === "OptionalNode";
}
function hasSet(tag) {
  return tag === "IsoNode" || tag === "PrismNode";
}
function getCompositionTag(a, b) {
  switch (a) {
    case "IsoNode":
      return b;
    case "LensNode":
      return hasFailingGet(b) ? "OptionalNode" : "LensNode";
    case "PrismNode":
      return hasSet(b) ? "PrismNode" : "OptionalNode";
    case "OptionalNode":
      return "OptionalNode";
  }
}
var identityIso = /* @__PURE__ */ make17(identityNode);
function id() {
  return identityIso;
}

// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/testing/FastCheck.js
var exports_FastCheck = {};
__export(exports_FastCheck, {
  webUrl: () => webUrl,
  webSegment: () => webSegment,
  webQueryParameters: () => webQueryParameters,
  webPath: () => webPath,
  webFragments: () => webFragments,
  webAuthority: () => webAuthority,
  uuid: () => uuid,
  uniqueArray: () => uniqueArray,
  ulid: () => ulid,
  uint8ClampedArray: () => uint8ClampedArray,
  uint8Array: () => uint8Array,
  uint32Array: () => uint32Array,
  uint16Array: () => uint16Array,
  tuple: () => tuple2,
  toStringMethod: () => toStringMethod,
  subarray: () => subarray,
  stringify: () => stringify,
  stringMatching: () => stringMatching,
  string: () => string3,
  stream: () => stream,
  statistics: () => statistics,
  sparseArray: () => sparseArray,
  shuffledSubarray: () => shuffledSubarray,
  set: () => set3,
  schedulerFor: () => schedulerFor,
  scheduler: () => scheduler,
  scheduledModelRun: () => scheduledModelRun,
  sample: () => sample,
  resetConfigureGlobal: () => resetConfigureGlobal,
  record: () => record2,
  readConfigureGlobal: () => readConfigureGlobal,
  property: () => property,
  pre: () => pre,
  option: () => option2,
  oneof: () => oneof,
  object: () => object,
  noShrink: () => noShrink,
  noBias: () => noBias,
  nat: () => nat,
  modelRun: () => modelRun,
  mixedCase: () => mixedCase,
  memo: () => memo,
  maxSafeNat: () => maxSafeNat,
  maxSafeInteger: () => maxSafeInteger,
  mapToConstant: () => mapToConstant,
  map: () => map10,
  lorem: () => lorem,
  limitShrink: () => limitShrink,
  letrec: () => letrec,
  jsonValue: () => jsonValue,
  json: () => json,
  ipV6: () => ipV6,
  ipV4Extended: () => ipV4Extended,
  ipV4: () => ipV4,
  integer: () => integer,
  int8Array: () => int8Array,
  int32Array: () => int32Array,
  int16Array: () => int16Array,
  infiniteStream: () => infiniteStream,
  hash: () => hash2,
  hasToStringMethod: () => hasToStringMethod,
  hasCloneMethod: () => hasCloneMethod,
  hasAsyncToStringMethod: () => hasAsyncToStringMethod,
  getDepthContextFor: () => getDepthContextFor,
  gen: () => gen2,
  func: () => func,
  float64Array: () => float64Array,
  float32Array: () => float32Array,
  float: () => float,
  falsy: () => falsy,
  entityGraph: () => entityGraph,
  emailAddress: () => emailAddress,
  double: () => double,
  domain: () => domain,
  dictionary: () => dictionary,
  defaultReportMessage: () => defaultReportMessage,
  date: () => date,
  createDepthIdentifier: () => createDepthIdentifier,
  context: () => context2,
  constantFrom: () => constantFrom,
  constant: () => constant2,
  configureGlobal: () => configureGlobal,
  compareFunc: () => compareFunc,
  compareBooleanFunc: () => compareBooleanFunc,
  commands: () => commands,
  cloneMethod: () => cloneMethod,
  cloneIfNeeded: () => cloneIfNeeded,
  clone: () => clone,
  check: () => check,
  chainUntil: () => chainUntil,
  boolean: () => boolean2,
  bigUint64Array: () => bigUint64Array,
  bigInt64Array: () => bigInt64Array,
  bigInt: () => bigInt2,
  base64String: () => base64String,
  asyncToStringMethod: () => asyncToStringMethod,
  asyncStringify: () => asyncStringify,
  asyncProperty: () => asyncProperty,
  asyncModelRun: () => asyncModelRun,
  asyncDefaultReportMessage: () => asyncDefaultReportMessage,
  assert: () => assert,
  array: () => array3,
  anything: () => anything,
  __version: () => __version,
  __type: () => __type,
  __commitHash: () => __commitHash,
  VerbosityLevel: () => VerbosityLevel,
  Value: () => Value,
  Stream: () => Stream,
  Random: () => Random,
  PreconditionFailure: () => PreconditionFailure,
  ExecutionStatus: () => ExecutionStatus,
  Arbitrary: () => Arbitrary
});

// ../../node_modules/.bun/pure-rand@8.4.0/node_modules/pure-rand/lib/esm/generator/congruential32.js
var MULTIPLIER = 214013;
var INCREMENT = 2531011;
var MASK = 4294967295;
var MASK_2 = -2147483649;
var JUMP_MULTIPLIER = 1994129409;
var JUMP_INCREMENT = 916127744;
var LinearCongruential32 = class LinearCongruential322 {
  constructor(seed) {
    this.seed = seed;
  }
  clone() {
    return new LinearCongruential322(this.seed);
  }
  next() {
    const s1 = computeNextSeed(this.seed);
    const v1 = computeValueFromNextSeed(s1);
    const s2 = computeNextSeed(s1);
    const v2 = computeValueFromNextSeed(s2);
    this.seed = computeNextSeed(s2);
    return computeValueFromNextSeed(this.seed) + (v2 + (v1 << 15) << 15) | 0;
  }
  jump() {
    this.seed = Math.imul(this.seed, JUMP_MULTIPLIER) + JUMP_INCREMENT & MASK;
  }
  getState() {
    return [this.seed];
  }
};
function computeNextSeed(seed) {
  return Math.imul(seed, MULTIPLIER) + INCREMENT & MASK;
}
function computeValueFromNextSeed(nextseed) {
  return (nextseed & MASK_2) >> 16;
}
function congruential32(seed) {
  return new LinearCongruential32(seed);
}

// ../../node_modules/.bun/pure-rand@8.4.0/node_modules/pure-rand/lib/esm/generator/mersenne.js
var N = 624;
var M = 397;
var A = 2567483615;
var F = 1812433253;
var U = 11;
var S = 7;
var B = 2636928640;
var T = 15;
var C = 4022730752;
var L = 18;
var MASK_LOWER = 2147483647;
var MASK_UPPER = 2147483648;
var JUMP_COEFS = "SUSgbA\\W`E[]KN2RUSo8XVU?HKBFRl11E\\KoWOg5B]XEWG;BE;1:oVK[`B^Z9Qd23^XTnhL>]Unda4f[X;_j9H5QD=cN<5H`3bW>9bk1mjoI2fK0obmAAINOV:>Mek_V9dd<hZ\\gC3?Fm7FEk07QH_3PLm^@?^i\\QMkgP<]oLHmFnlecg5F@7U^@4jhZ?WZS0k@GHehmM36:5^9;>Hmm`co>k:KOSkSbIINb1VFf>LXgP>GUAQTD>Ci>XMGkUflLlb?_FaFUk@?5N7i70@;1o68ah@I<HFH7R2^J:G][Gf962ITWID9GWK8ElD2G5=DcHcL]cA]P2n7A=[<bInM;IHDQnJMReRXDWbVldnGEIPij`E08Xdci3@0c:IBbD4:Nk]?lEN9j^;T`0blZX7eiWE8c`<ak7j05FZi>AjUDh?M1B?^??FAXKThf<aBOXZf7jXYGK>R<;NHk3S9YhM7STJ6`:MIE`S@7298X8W>PNK=@;lLX<i\\TXLL<W@X[X54H]in8M;;n?kkQbajgAMY=Tf9b;ZKf0QUB2FHYWfnfkDoU9YkcLd95T>lK6GM1YL\\lid:J>KYS=iJ]Y>QlF>?R5_[5QeYC=66;A32Ac>OHk_ne^0g>bK:g;KFPgbGUcPR_Z=TX3H9d03bKZ2IhEPKBo>LSGWd0iFdV8C<Y:<>T[O6lC\\blaZ>GoAYP4clf^j1IfnZJ]QeDe2X<HE[LJNWnaCg[P]Co^:IRbWPY?97UePBlZNNHY6LOBM8P>=h?Ye:_f_Sb9Ki5GDYBF4dWeMfdg^ccPllNWM7G1\\UMdoYeOOD5^e@foA22G?ADYo5:FVG[bWo96;>3kc_c1Ab30>30;1@4F8g2hY?DJ4[LOL;ZLLKo2]jo>[KMDUcR279N_kF=3WL@Dd620bMTdA\\U9k``ef2iD9JgJ8CZBHS>F^Uk;<laeaeHS<15OSeS`PcSSKBRBFY]aQ=EgUXGNg=?d56`KA@2BejY0^[_DCX`L=CGMT=BW^6S1i@2ATBVk>3_ocRA>2U:4GPQ6o>5jX2HIcV3S@On6KB<[SKB?FC_AAji9agbBFkAi\\;4I\\UJ]c36Ub@[;gQACVGY<V]SDJBUU]La\\_a@JdOO8gm2T0DJMa:8Hf7>E]noQ[1Kambn??QQ]S?1i0oMGOijb\\aGY6lQ^CJ?9bFle8<eH4UUjBINX;n8@VOA5ah^URV49B[A?ONHhHAC1J5;;h0SXYlG^0W=eJdHh^K4SGe=1HZLLam;D<Q3AOdbPcdX``82\\jo0En8jRVGC73WMCF9`d:0heS?80?C188cSn7H9<daZ]MgS4Pb^1HkA:1PU^5>^h_g[RQV@PnYBRI_]`B]Bh@Uk03eXGY`I16L76H28X`R>IROMeNVUdU[:lghLhPCQZ:4a<30YBZCYnXe[?;jc8gKI2QH2MjnWBm4nGCZW`aVU2a;P<AMI25mlW_Nm][2?b6o851X@lAm]YZ`bWRF1g<Ga:T]1NXH5Veja5P9S9>:aNg:Th1Y=5o78K>LQ8hW@5S?I83Lk5Xk;j5@I3o[d:4RjE^oS30:WP9gC\\i8aSI>QRE@4lP:7lDg8g2`Ql[2I8aBU\\BQ?B4_clL9Q]S;^e1Ob5[>3JER2`c7B=o]fPOWO<DGi;Niba1PoWPPE_Q3aX0OB0mZej\\f_M[J4Y6]1`h2MkF[GiW8Q^d3^_=<I1N2Q7]2<2j[iP7V3V821FaI]A`93bC^Z\\G=WJ;^Ih?B97_iIF@\\Dl<eK1je8SNTWo_=XFMZH<<JYLZ^YQMPgYOV45K_:]kSI8^XlO0]GY=VUfe_C_F6TOcoAlVUH:o=WhhT@K`2KFhe<3\\KXQ>W:M?S_4S5d@J^`[AGA7@3]DnGSCO`\\?E8HT75^d9\\:m\\m1egIfk8cd6bD9\\eU8\\n[Pb0Cgd^S0n9kGJHb]i5XodlKHc34Fhi9K>0U5WK`>7Ff2^KL=WC6:kc?e5C^a1T1:4:^S5flXlGNIj08AfO?Dh7T7dWO>E]NI9?ob7B7P_h[4TEP[EU;GllFTnSmg9:\\[N]<SAoKP_kPlG56A:I3T6EG8Hj=XnUE`KT5U@OQ?]7[N^MFN1_NU4KO_3::Le`8IL9[1Z1H1;V3SC\\N3]S@4U[F2mhT5dYM7[4Pg_Na0_8WTH0`bgceQS8]EG;XgD4Ib4iLTP@kE79Mn>AYRJA1U5^Blhgno:aHVYc03c3J0Vc9FjEV^M75Zfd8kVC9>iJDk`AJ[6f7DK2D^DL\\AX:6b5h31XH;RQB\\N<ZSM=J;6L[`UW^eOIFc1Y]6_dfedIe4ARh72mTXC0WND_IDHVCZRDE0eODARCEETQI5TPUQE=jEH5bS?LP[ai`F5ABRYDo2o\\@=]GT?_9;hc4Lm:\\SF9k1T<0E@fX9BG[]g0nY7k[Qmi@la8`PF0j6@Q?Ii7bLkXQ<lLHf]`:DCh@9JY5>hEVLTdhL\\b1EB0lLh<=WaO@F<;8g<d:@e:LA:cFIEdmQh7hNHfSRToW?8N4:Z1K;XEDRO;OIDh<UdVln?bjgL>?VE98[B\\K<BVjkG8LiSX;fb>jf?DUK00Aih<WY6QD6cEnHBZ8iN_fd<G8Ci`11RUW2QlW]IXV:m?;J0GXXHfGNQ>:D`=fLPbO?VOTEYLj^cNj5PM>jKB5HVjJ4U7lXaTQNL9<@\\1`m\\Ug@VQHd7>jW=ca0`miF7;N0F=GjoQ`RFchKMGTmn8cF@Oh4GGCm7m2`U9j93Tb>=kSERjE_J939F01I1;`<ijk_=_Vn=7RVAI6fnQI5KlF:C44bN<<8K=Z<2TP<1]5?<dB>^LA=ebloE2Y2:9lkh0\\<YKbHD97iE`<C5oj^1>X:??`H6BXF2hG1Q[dF0Q=>W=J?7C\\k1T?<;R44oW?1hY^G8Zm]ZKnfOf0eCFYo6?=D8?<`6HU5SXh1;=:23LmV_FSi;OJfV<^?GkIDPISeHg1LaGE:V3Y3K3H<QJfbY?=;ldZRhnhQT_mGXDLFXXhSONE6Do_0iNZagB:BPGOTH;VhHUTd6LhQm^[;dO]5Hlkg<R:F<Kn\\:I:EGojgWZ2X@SYO_dlH;G8S<>oEKabY`:oU;=JW7ig?S?EYb86b7n8ce\\]IRa]koiWY<RfO;5kUI;7lVeC?[@ZaXDiF04B8R]bg@>O<mQDoUcBLcf^f>m2kMBUloD>Ze@NN^Z11TM`inXYhE_I=kA`:ZF4d\\>`L@;ZP[`ENU5cL[BV6\\Z?Di76:jg3hE6oG6jFc8kP=[GS1;WSedYQW1:U4\\OF32GgmMC<AjO]872bdBb`bKAA?8j78b>T3VfcUB2m4J^CPRU;8dScI]LU]^bBYA5_3:Y0N5i^?200000";
var MersenneTwister = class MersenneTwister2 {
  constructor(states, index2) {
    this.states = states;
    this.index = index2;
  }
  clone() {
    return new MersenneTwister2(this.states.slice(), this.index);
  }
  next() {
    let y = this.states[this.index];
    y ^= y >>> U;
    y ^= y << S & B;
    y ^= y << T & C;
    y ^= y >>> L;
    this.index = twistedNext(this.states, this.index);
    return y;
  }
  getState() {
    return [this.index, ...this.states];
  }
  jump() {
    const originalStates = this.states.slice();
    const originalIndex = this.index;
    this.index = twistedNext(this.states, this.index);
    for (let i = 19932;i > 0; --i) {
      if (JUMP_COEFS.charCodeAt(i / 6 | 0) - 48 & 1 << i % 6)
        addState(this.states, this.index, originalStates, originalIndex);
      this.index = twistedNext(this.states, this.index);
    }
    addState(this.states, this.index, originalStates, originalIndex);
  }
};
function addState(mt, idx, originalMt, originalIdx) {
  let i = 0;
  if (originalIdx >= idx) {
    for (;i < N - originalIdx; i++)
      mt[i + idx] ^= originalMt[i + originalIdx];
    for (;i < N - idx; i++)
      mt[i + idx] ^= originalMt[i + originalIdx - N];
    for (;i < N; i++)
      mt[i + idx - N] ^= originalMt[i + originalIdx - N];
  } else {
    for (;i < N - idx; i++)
      mt[i + idx] ^= originalMt[i + originalIdx];
    for (;i < N - originalIdx; i++)
      mt[i + idx - N] ^= originalMt[i + originalIdx];
    for (;i < N; i++)
      mt[i + idx - N] ^= originalMt[i + originalIdx - N];
  }
}
function twistedNext(mt, idx) {
  if (idx < N - M) {
    const y = mt[idx] & MASK_UPPER | mt[idx + 1] & MASK_LOWER;
    mt[idx] = mt[idx + M] ^ y >>> 1 ^ -(y & 1) & A;
    return idx + 1;
  } else if (idx < N - 1) {
    const y = mt[idx] & MASK_UPPER | mt[idx + 1] & MASK_LOWER;
    mt[idx] = mt[idx + M - N] ^ y >>> 1 ^ -(y & 1) & A;
    return idx + 1;
  } else {
    const y = mt[idx] & MASK_UPPER | mt[0] & MASK_LOWER;
    mt[idx] = mt[M - 1] ^ y >>> 1 ^ -(y & 1) & A;
    return 0;
  }
}
function twist(mt) {
  for (let idx = 0;idx !== N; ++idx)
    twistedNext(mt, idx);
}
function mersenne(seed) {
  const out = [seed | 0];
  for (let idx = 1;idx !== N; ++idx) {
    const xored = out[idx - 1] ^ out[idx - 1] >>> 30;
    out.push(Math.imul(F, xored) + idx | 0);
  }
  twist(out);
  return new MersenneTwister(out, 0);
}

// ../../node_modules/.bun/pure-rand@8.4.0/node_modules/pure-rand/lib/esm/generator/xorshift128plus.js
var XorShift128Plus = class XorShift128Plus2 {
  constructor(s01, s00, s11, s10) {
    this.s01 = s01;
    this.s00 = s00;
    this.s11 = s11;
    this.s10 = s10;
  }
  clone() {
    return new XorShift128Plus2(this.s01, this.s00, this.s11, this.s10);
  }
  next() {
    const a0 = this.s00 ^ this.s00 << 23;
    const a1 = this.s01 ^ (this.s01 << 23 | this.s00 >>> 9);
    const b0 = a0 ^ this.s10 ^ (a0 >>> 18 | a1 << 14) ^ (this.s10 >>> 5 | this.s11 << 27);
    const b1 = a1 ^ this.s11 ^ a1 >>> 18 ^ this.s11 >>> 5;
    const out = this.s00 + this.s10 | 0;
    this.s01 = this.s11;
    this.s00 = this.s10;
    this.s11 = b1;
    this.s10 = b0;
    return out;
  }
  jump() {
    let ns01 = 0;
    let ns00 = 0;
    let ns11 = 0;
    let ns10 = 0;
    const jump = [
      1667051007,
      2321340297,
      1548169110,
      304075285
    ];
    for (let i = 0;i !== 4; ++i)
      for (let mask2 = 1;mask2; mask2 <<= 1) {
        if (jump[i] & mask2) {
          ns01 ^= this.s01;
          ns00 ^= this.s00;
          ns11 ^= this.s11;
          ns10 ^= this.s10;
        }
        this.next();
      }
    this.s01 = ns01;
    this.s00 = ns00;
    this.s11 = ns11;
    this.s10 = ns10;
  }
  getState() {
    return [
      this.s01,
      this.s00,
      this.s11,
      this.s10
    ];
  }
};
function xorshift128plus(seed) {
  return new XorShift128Plus(-1, ~seed, seed | 0, 0);
}

// ../../node_modules/.bun/pure-rand@8.4.0/node_modules/pure-rand/lib/esm/generator/xoroshiro128plus.js
var XoroShiro128Plus = class XoroShiro128Plus2 {
  constructor(s01, s00, s11, s10) {
    this.s01 = s01;
    this.s00 = s00;
    this.s11 = s11;
    this.s10 = s10;
  }
  clone() {
    return new XoroShiro128Plus2(this.s01, this.s00, this.s11, this.s10);
  }
  next() {
    const out = this.s00 + this.s10 | 0;
    const a0 = this.s10 ^ this.s00;
    const a1 = this.s11 ^ this.s01;
    const s00 = this.s00;
    const s01 = this.s01;
    this.s00 = s00 << 24 ^ s01 >>> 8 ^ a0 ^ a0 << 16;
    this.s01 = s01 << 24 ^ s00 >>> 8 ^ a1 ^ (a1 << 16 | a0 >>> 16);
    this.s10 = a1 << 5 ^ a0 >>> 27;
    this.s11 = a0 << 5 ^ a1 >>> 27;
    return out;
  }
  jump() {
    let ns01 = 0;
    let ns00 = 0;
    let ns11 = 0;
    let ns10 = 0;
    const jump = [
      3639956645,
      3750757012,
      1261568508,
      386426335
    ];
    for (let i = 0;i !== 4; ++i)
      for (let mask2 = 1;mask2; mask2 <<= 1) {
        if (jump[i] & mask2) {
          ns01 ^= this.s01;
          ns00 ^= this.s00;
          ns11 ^= this.s11;
          ns10 ^= this.s10;
        }
        this.next();
      }
    this.s01 = ns01;
    this.s00 = ns00;
    this.s11 = ns11;
    this.s10 = ns10;
  }
  getState() {
    return [
      this.s01,
      this.s00,
      this.s11,
      this.s10
    ];
  }
};
function xoroshiro128plus(seed) {
  return new XoroShiro128Plus(-1, ~seed, seed | 0, 0);
}

// ../../node_modules/.bun/pure-rand@8.4.0/node_modules/pure-rand/lib/esm/utils/skipN.js
function skipN(rng, num) {
  for (let idx = 0;idx !== num; ++idx)
    rng.next();
}

// ../../node_modules/.bun/pure-rand@8.4.0/node_modules/pure-rand/lib/esm/distribution/uniformBigInt.js
var SBigInt = BigInt;
var NumValues = 4294967296n;
function uniformBigInt(rng, from, to) {
  const diff = to - from + 1n;
  let FinalNumValues = NumValues;
  let NumIterations = 1;
  while (FinalNumValues < diff) {
    FinalNumValues <<= 32n;
    ++NumIterations;
  }
  let value3 = generateNext(NumIterations, rng);
  if (value3 < diff)
    return value3 + from;
  if (value3 + diff < FinalNumValues)
    return value3 % diff + from;
  const MaxAcceptedRandom = FinalNumValues - FinalNumValues % diff;
  while (value3 >= MaxAcceptedRandom)
    value3 = generateNext(NumIterations, rng);
  return value3 % diff + from;
}
function generateNext(NumIterations, rng) {
  let value3 = SBigInt(rng.next() + 2147483648);
  for (let num = 1;num < NumIterations; ++num) {
    const out = rng.next();
    value3 = (value3 << 32n) + SBigInt(out + 2147483648);
  }
  return value3;
}

// ../../node_modules/.bun/pure-rand@8.4.0/node_modules/pure-rand/lib/esm/distribution/uniformInt.js
function uniformIntInternal(rng, rangeSize) {
  const MaxAllowed = rangeSize > 2 ? ~~(4294967296 / rangeSize) * rangeSize : 4294967296;
  let deltaV = rng.next() + 2147483648;
  while (deltaV >= MaxAllowed)
    deltaV = rng.next() + 2147483648;
  return deltaV % rangeSize;
}
function fromNumberToArrayInt64(out, n) {
  if (n < 0) {
    const posN = -n;
    out.sign = -1;
    out.data[0] = ~~(posN / 4294967296);
    out.data[1] = posN >>> 0;
  } else {
    out.sign = 1;
    out.data[0] = ~~(n / 4294967296);
    out.data[1] = n >>> 0;
  }
  return out;
}
function substractArrayInt64(out, arrayIntA, arrayIntB) {
  const lowA = arrayIntA.data[1];
  const highA = arrayIntA.data[0];
  const signA = arrayIntA.sign;
  const lowB = arrayIntB.data[1];
  const highB = arrayIntB.data[0];
  const signB = arrayIntB.sign;
  out.sign = 1;
  if (signA === 1 && signB === -1) {
    const low2 = lowA + lowB;
    const high = highA + highB + (low2 > 4294967295 ? 1 : 0);
    out.data[0] = high >>> 0;
    out.data[1] = low2 >>> 0;
    return out;
  }
  let lowFirst = lowA;
  let highFirst = highA;
  let lowSecond = lowB;
  let highSecond = highB;
  if (signA === -1) {
    lowFirst = lowB;
    highFirst = highB;
    lowSecond = lowA;
    highSecond = highA;
  }
  let reminderLow = 0;
  let low = lowFirst - lowSecond;
  if (low < 0) {
    reminderLow = 1;
    low = low >>> 0;
  }
  out.data[0] = highFirst - highSecond - reminderLow;
  out.data[1] = low;
  return out;
}
function uniformArrayIntInternal(rng, out, rangeSize) {
  const maxIndex0 = rangeSize[0] + 1;
  out[0] = uniformIntInternal(rng, maxIndex0);
  out[1] = uniformIntInternal(rng, 4294967296);
  while (out[0] >= rangeSize[0] && (out[0] !== rangeSize[0] || out[1] >= rangeSize[1])) {
    out[0] = uniformIntInternal(rng, maxIndex0);
    out[1] = uniformIntInternal(rng, 4294967296);
  }
  return out;
}
var safeNumberMaxSafeInteger = Number.MAX_SAFE_INTEGER;
var sharedA = {
  sign: 1,
  data: [0, 0]
};
var sharedB = {
  sign: 1,
  data: [0, 0]
};
var sharedC = {
  sign: 1,
  data: [0, 0]
};
var sharedData = [0, 0];
function uniformLargeIntInternal(rng, from, to, rangeSize) {
  const rangeSizeArrayIntValue = rangeSize <= safeNumberMaxSafeInteger ? fromNumberToArrayInt64(sharedC, rangeSize) : substractArrayInt64(sharedC, fromNumberToArrayInt64(sharedA, to), fromNumberToArrayInt64(sharedB, from));
  if (rangeSizeArrayIntValue.data[1] === 4294967295) {
    rangeSizeArrayIntValue.data[0] += 1;
    rangeSizeArrayIntValue.data[1] = 0;
  } else
    rangeSizeArrayIntValue.data[1] += 1;
  uniformArrayIntInternal(rng, sharedData, rangeSizeArrayIntValue.data);
  return sharedData[0] * 4294967296 + sharedData[1] + from;
}
function uniformInt(rng, from, to) {
  const rangeSize = to - from;
  if (rangeSize <= 4294967295)
    return uniformIntInternal(rng, rangeSize + 1) + from;
  return uniformLargeIntInternal(rng, from, to, rangeSize);
}

// ../../node_modules/.bun/fast-check@4.8.0/node_modules/fast-check/lib/fast-check.js
var SharedFootPrint = Symbol.for("fast-check/PreconditionFailure");
var PreconditionFailure = class extends Error {
  constructor(interruptExecution = false) {
    super();
    this.interruptExecution = interruptExecution;
    this.footprint = SharedFootPrint;
  }
  static isFailure(err) {
    return err !== null && err !== undefined && err.footprint === SharedFootPrint;
  }
};
function pre(expectTruthy) {
  if (!expectTruthy)
    throw new PreconditionFailure;
}
var Nil = class {
  [Symbol.iterator]() {
    return this;
  }
  next(value3) {
    return {
      value: value3,
      done: true
    };
  }
};
var nil = new Nil;
function nilHelper() {
  return nil;
}
function* mapHelper(g, f) {
  for (const v of g)
    yield f(v);
}
function* flatMapHelper(g, f) {
  for (const v of g)
    yield* f(v);
}
function* filterHelper(g, f) {
  for (const v of g)
    if (f(v))
      yield v;
}
function* takeNHelper(g, n) {
  for (let i = 0;i < n; ++i) {
    const cur = g.next();
    if (cur.done)
      break;
    yield cur.value;
  }
}
function* takeWhileHelper(g, f) {
  let cur = g.next();
  while (!cur.done && f(cur.value)) {
    yield cur.value;
    cur = g.next();
  }
}
function* joinHelper(g, others) {
  for (let cur = g.next();!cur.done; cur = g.next())
    yield cur.value;
  for (const s of others)
    for (let cur = s.next();!cur.done; cur = s.next())
      yield cur.value;
}
var safeSymbolIterator$1 = Symbol.iterator;
var Stream = class Stream2 {
  static nil() {
    return new Stream2(nilHelper());
  }
  static of(...elements) {
    return new Stream2(elements[safeSymbolIterator$1]());
  }
  constructor(g) {
    this.g = g;
  }
  next() {
    return this.g.next();
  }
  [Symbol.iterator]() {
    return this.g;
  }
  map(f) {
    return new Stream2(mapHelper(this.g, f));
  }
  flatMap(f) {
    return new Stream2(flatMapHelper(this.g, f));
  }
  dropWhile(f) {
    let foundEligible = false;
    function* helper(v) {
      if (foundEligible || !f(v)) {
        foundEligible = true;
        yield v;
      }
    }
    return this.flatMap(helper);
  }
  drop(n) {
    if (n <= 0)
      return this;
    let idx = 0;
    function helper() {
      return idx++ < n;
    }
    return this.dropWhile(helper);
  }
  takeWhile(f) {
    return new Stream2(takeWhileHelper(this.g, f));
  }
  take(n) {
    return new Stream2(takeNHelper(this.g, n));
  }
  filter(f) {
    return new Stream2(filterHelper(this.g, f));
  }
  every(f) {
    for (const v of this.g)
      if (!f(v))
        return false;
    return true;
  }
  has(f) {
    for (const v of this.g)
      if (f(v))
        return [true, v];
    return [false, null];
  }
  join(...others) {
    return new Stream2(joinHelper(this.g, others));
  }
  getNthOrLast(nth) {
    let remaining = nth;
    let last = null;
    for (const v of this.g) {
      if (remaining-- === 0)
        return v;
      last = v;
    }
    return last;
  }
};
function stream(g) {
  return new Stream(g);
}
var cloneMethod = Symbol.for("fast-check/cloneMethod");
function hasCloneMethod(instance) {
  return instance !== null && (typeof instance === "object" || typeof instance === "function") && cloneMethod in instance && typeof instance[cloneMethod] === "function";
}
function cloneIfNeeded(instance) {
  return hasCloneMethod(instance) ? instance[cloneMethod]() : instance;
}
var safeObjectDefineProperty$4 = Object.defineProperty;
var Value = class {
  constructor(value_, context2, customGetValue) {
    this.value_ = value_;
    this.context = context2;
    this.hasToBeCloned = customGetValue !== undefined || hasCloneMethod(value_);
    this.readOnce = false;
    this.value = value_;
    if (this.hasToBeCloned)
      safeObjectDefineProperty$4(this, "value", {
        get: customGetValue !== undefined ? customGetValue : this.getValue,
        enumerable: false,
        configurable: false
      });
  }
  getValue() {
    if (this.hasToBeCloned) {
      if (!this.readOnce) {
        this.readOnce = true;
        return this.value_;
      }
      return this.value_[cloneMethod]();
    }
    return this.value_;
  }
};
var Arbitrary = class {
  filter(refinement) {
    return new FilterArbitrary(this, refinement);
  }
  map(mapper, unmapper) {
    return new MapArbitrary(this, mapper, unmapper);
  }
  chain(chainer) {
    return new ChainArbitrary(this, chainer);
  }
};
var ChainArbitrary = class extends Arbitrary {
  constructor(arb, chainer) {
    super();
    this.arb = arb;
    this.chainer = chainer;
  }
  generate(mrng, biasFactor) {
    const clonedMrng = mrng.clone();
    const src = this.arb.generate(mrng, biasFactor);
    return this.valueChainer(src, mrng, clonedMrng, biasFactor);
  }
  canShrinkWithoutContext(_value) {
    return false;
  }
  shrink(value3, context2) {
    if (this.isSafeContext(context2))
      return (!context2.stoppedForOriginal ? this.arb.shrink(context2.originalValue, context2.originalContext).map((v) => this.valueChainer(v, context2.clonedMrng.clone(), context2.clonedMrng, context2.originalBias)) : Stream.nil()).join(context2.chainedArbitrary.shrink(value3, context2.chainedContext).map((dst) => {
        const newContext = {
          ...context2,
          chainedContext: dst.context,
          stoppedForOriginal: true
        };
        return new Value(dst.value_, newContext);
      }));
    return Stream.nil();
  }
  valueChainer(v, generateMrng, clonedMrng, biasFactor) {
    const chainedArbitrary = this.chainer(v.value_);
    const dst = chainedArbitrary.generate(generateMrng, biasFactor);
    const context2 = {
      originalBias: biasFactor,
      originalValue: v.value_,
      originalContext: v.context,
      stoppedForOriginal: false,
      chainedArbitrary,
      chainedContext: dst.context,
      clonedMrng
    };
    return new Value(dst.value_, context2);
  }
  isSafeContext(context2) {
    return context2 !== null && context2 !== undefined && typeof context2 === "object" && "originalBias" in context2 && "originalValue" in context2 && "originalContext" in context2 && "stoppedForOriginal" in context2 && "chainedArbitrary" in context2 && "chainedContext" in context2 && "clonedMrng" in context2;
  }
};
var MapArbitrary = class extends Arbitrary {
  constructor(arb, mapper, unmapper) {
    super();
    this.arb = arb;
    this.mapper = mapper;
    this.unmapper = unmapper;
    this.bindValueMapper = (v) => this.valueMapper(v);
  }
  generate(mrng, biasFactor) {
    const g = this.arb.generate(mrng, biasFactor);
    return this.valueMapper(g);
  }
  canShrinkWithoutContext(value3) {
    if (this.unmapper !== undefined)
      try {
        const unmapped = this.unmapper(value3);
        return this.arb.canShrinkWithoutContext(unmapped);
      } catch {
        return false;
      }
    return false;
  }
  shrink(value3, context2) {
    if (this.isSafeContext(context2))
      return this.arb.shrink(context2.originalValue, context2.originalContext).map(this.bindValueMapper);
    if (this.unmapper !== undefined) {
      const unmapped = this.unmapper(value3);
      return this.arb.shrink(unmapped, undefined).map(this.bindValueMapper);
    }
    return Stream.nil();
  }
  mapperWithCloneIfNeeded(v) {
    const sourceValue = v.value;
    const mappedValue = this.mapper(sourceValue);
    if (v.hasToBeCloned && (typeof mappedValue === "object" && mappedValue !== null || typeof mappedValue === "function") && Object.isExtensible(mappedValue) && !hasCloneMethod(mappedValue))
      Object.defineProperty(mappedValue, cloneMethod, { get: () => () => this.mapperWithCloneIfNeeded(v)[0] });
    return [mappedValue, sourceValue];
  }
  valueMapper(v) {
    const [mappedValue, sourceValue] = this.mapperWithCloneIfNeeded(v);
    return new Value(mappedValue, {
      originalValue: sourceValue,
      originalContext: v.context
    });
  }
  isSafeContext(context2) {
    return context2 !== null && context2 !== undefined && typeof context2 === "object" && "originalValue" in context2 && "originalContext" in context2;
  }
};
var FilterArbitrary = class extends Arbitrary {
  constructor(arb, refinement) {
    super();
    this.arb = arb;
    this.refinement = refinement;
    this.bindRefinementOnValue = (v) => this.refinementOnValue(v);
  }
  generate(mrng, biasFactor) {
    while (true) {
      const g = this.arb.generate(mrng, biasFactor);
      if (this.refinementOnValue(g))
        return g;
    }
  }
  canShrinkWithoutContext(value3) {
    return this.arb.canShrinkWithoutContext(value3) && this.refinement(value3);
  }
  shrink(value3, context2) {
    return this.arb.shrink(value3, context2).filter(this.bindRefinementOnValue);
  }
  refinementOnValue(v) {
    return this.refinement(v.value);
  }
};
function isArbitrary(instance) {
  return typeof instance === "object" && instance !== null && "generate" in instance && "shrink" in instance && "canShrinkWithoutContext" in instance;
}
function assertIsArbitrary(instance) {
  if (!isArbitrary(instance))
    throw new Error("Unexpected value received: not an instance of Arbitrary");
}
var untouchedApply = Function.prototype.apply;
var ApplySymbol = Symbol("apply");
function safeExtractApply(f) {
  try {
    return f.apply;
  } catch {
    return;
  }
}
function safeApplyHacky(f, instance, args2) {
  const ff = f;
  ff[ApplySymbol] = untouchedApply;
  const out = ff[ApplySymbol](instance, args2);
  delete ff[ApplySymbol];
  return out;
}
function safeApply(f, instance, args2) {
  if (safeExtractApply(f) === untouchedApply)
    return f.apply(instance, args2);
  return safeApplyHacky(f, instance, args2);
}
var SArray = Array;
var SBigInt2 = BigInt;
var SBigInt64Array = BigInt64Array;
var SBigUint64Array = BigUint64Array;
var SBoolean = Boolean;
var SDate = Date;
var SError = Error;
var SFloat32Array = Float32Array;
var SFloat64Array = Float64Array;
var SInt8Array = Int8Array;
var SInt16Array = Int16Array;
var SInt32Array = Int32Array;
var SNumber = Number;
var SString = String;
var SSet = Set;
var SUint8Array = Uint8Array;
var SUint8ClampedArray = Uint8ClampedArray;
var SUint16Array = Uint16Array;
var SUint32Array = Uint32Array;
var SencodeURIComponent = encodeURIComponent;
var SMap$1 = Map;
var SSymbol = Symbol;
var untouchedForEach = Array.prototype.forEach;
var untouchedIndexOf = Array.prototype.indexOf;
var untouchedJoin = Array.prototype.join;
var untouchedMap = Array.prototype.map;
var untouchedFlat = Array.prototype.flat;
var untouchedFilter = Array.prototype.filter;
var untouchedPush = Array.prototype.push;
var untouchedPop = Array.prototype.pop;
var untouchedSplice = Array.prototype.splice;
var untouchedSlice = Array.prototype.slice;
var untouchedSort = Array.prototype.sort;
var untouchedEvery = Array.prototype.every;
function extractForEach(instance) {
  try {
    return instance.forEach;
  } catch {
    return;
  }
}
function extractIndexOf(instance) {
  try {
    return instance.indexOf;
  } catch {
    return;
  }
}
function extractJoin(instance) {
  try {
    return instance.join;
  } catch {
    return;
  }
}
function extractMap(instance) {
  try {
    return instance.map;
  } catch {
    return;
  }
}
function extractFlat(instance) {
  try {
    return instance.flat;
  } catch {
    return;
  }
}
function extractFilter(instance) {
  try {
    return instance.filter;
  } catch {
    return;
  }
}
function extractPush(instance) {
  try {
    return instance.push;
  } catch {
    return;
  }
}
function extractPop(instance) {
  try {
    return instance.pop;
  } catch {
    return;
  }
}
function extractSplice(instance) {
  try {
    return instance.splice;
  } catch {
    return;
  }
}
function extractSlice(instance) {
  try {
    return instance.slice;
  } catch {
    return;
  }
}
function extractSort(instance) {
  try {
    return instance.sort;
  } catch {
    return;
  }
}
function extractEvery(instance) {
  try {
    return instance.every;
  } catch {
    return;
  }
}
function safeForEach(instance, fn2) {
  if (extractForEach(instance) === untouchedForEach)
    return instance.forEach(fn2);
  return safeApply(untouchedForEach, instance, [fn2]);
}
function safeIndexOf(instance, ...args2) {
  if (extractIndexOf(instance) === untouchedIndexOf)
    return instance.indexOf(...args2);
  return safeApply(untouchedIndexOf, instance, args2);
}
function safeJoin(instance, ...args2) {
  if (extractJoin(instance) === untouchedJoin)
    return instance.join(...args2);
  return safeApply(untouchedJoin, instance, args2);
}
function safeMap(instance, fn2) {
  if (extractMap(instance) === untouchedMap)
    return instance.map(fn2);
  return safeApply(untouchedMap, instance, [fn2]);
}
function safeFlat(instance, depth) {
  if (extractFlat(instance) === untouchedFlat) {
    [].flat();
    return instance.flat(depth);
  }
  return safeApply(untouchedFlat, instance, [depth]);
}
function safeFilter(instance, predicate) {
  if (extractFilter(instance) === untouchedFilter)
    return instance.filter(predicate);
  return safeApply(untouchedFilter, instance, [predicate]);
}
function safePush(instance, ...args2) {
  if (extractPush(instance) === untouchedPush)
    return instance.push(...args2);
  return safeApply(untouchedPush, instance, args2);
}
function safePop$1(instance) {
  if (extractPop(instance) === untouchedPop)
    return instance.pop();
  return safeApply(untouchedPop, instance, []);
}
function safeSplice(instance, ...args2) {
  if (extractSplice(instance) === untouchedSplice)
    return instance.splice(...args2);
  return safeApply(untouchedSplice, instance, args2);
}
function safeSlice(instance, ...args2) {
  if (extractSlice(instance) === untouchedSlice)
    return instance.slice(...args2);
  return safeApply(untouchedSlice, instance, args2);
}
function safeSort(instance, ...args2) {
  if (extractSort(instance) === untouchedSort)
    return instance.sort(...args2);
  return safeApply(untouchedSort, instance, args2);
}
function safeEvery(instance, ...args2) {
  if (extractEvery(instance) === untouchedEvery)
    return instance.every(...args2);
  return safeApply(untouchedEvery, instance, args2);
}
var untouchedGetTime = Date.prototype.getTime;
var untouchedToISOString = Date.prototype.toISOString;
function extractGetTime(instance) {
  try {
    return instance.getTime;
  } catch {
    return;
  }
}
function extractToISOString(instance) {
  try {
    return instance.toISOString;
  } catch {
    return;
  }
}
function safeGetTime(instance) {
  if (extractGetTime(instance) === untouchedGetTime)
    return instance.getTime();
  return safeApply(untouchedGetTime, instance, []);
}
function safeToISOString(instance) {
  if (extractToISOString(instance) === untouchedToISOString)
    return instance.toISOString();
  return safeApply(untouchedToISOString, instance, []);
}
var untouchedAdd = Set.prototype.add;
var untouchedHas = Set.prototype.has;
function extractAdd(instance) {
  try {
    return instance.add;
  } catch {
    return;
  }
}
function extractHas(instance) {
  try {
    return instance.has;
  } catch (err) {
    return;
  }
}
function safeAdd(instance, value3) {
  if (extractAdd(instance) === untouchedAdd)
    return instance.add(value3);
  return safeApply(untouchedAdd, instance, [value3]);
}
function safeHas(instance, value3) {
  if (extractHas(instance) === untouchedHas)
    return instance.has(value3);
  return safeApply(untouchedHas, instance, [value3]);
}
var untouchedSet = WeakMap.prototype.set;
var untouchedGet = WeakMap.prototype.get;
function extractSet(instance) {
  try {
    return instance.set;
  } catch (err) {
    return;
  }
}
function extractGet(instance) {
  try {
    return instance.get;
  } catch (err) {
    return;
  }
}
function safeSet(instance, key, value3) {
  if (extractSet(instance) === untouchedSet)
    return instance.set(key, value3);
  return safeApply(untouchedSet, instance, [key, value3]);
}
function safeGet(instance, key) {
  if (extractGet(instance) === untouchedGet)
    return instance.get(key);
  return safeApply(untouchedGet, instance, [key]);
}
var untouchedMapSet = Map.prototype.set;
var untouchedMapGet = Map.prototype.get;
var untouchedMapHas = Map.prototype.has;
function extractMapSet(instance) {
  try {
    return instance.set;
  } catch (err) {
    return;
  }
}
function extractMapGet(instance) {
  try {
    return instance.get;
  } catch (err) {
    return;
  }
}
function extractMapHas(instance) {
  try {
    return instance.has;
  } catch (err) {
    return;
  }
}
function safeMapSet(instance, key, value3) {
  if (extractMapSet(instance) === untouchedMapSet)
    return instance.set(key, value3);
  return safeApply(untouchedMapSet, instance, [key, value3]);
}
function safeMapGet(instance, key) {
  if (extractMapGet(instance) === untouchedMapGet)
    return instance.get(key);
  return safeApply(untouchedMapGet, instance, [key]);
}
function safeMapHas(instance, key) {
  if (extractMapHas(instance) === untouchedMapHas)
    return instance.has(key);
  return safeApply(untouchedMapHas, instance, [key]);
}
var untouchedSplit = String.prototype.split;
var untouchedStartsWith = String.prototype.startsWith;
var untouchedEndsWith = String.prototype.endsWith;
var untouchedSubstring = String.prototype.substring;
var untouchedToLowerCase = String.prototype.toLowerCase;
var untouchedToUpperCase = String.prototype.toUpperCase;
var untouchedPadStart = String.prototype.padStart;
var untouchedCharCodeAt = String.prototype.charCodeAt;
var untouchedNormalize = String.prototype.normalize;
var untouchedReplace = String.prototype.replace;
function extractSplit(instance) {
  try {
    return instance.split;
  } catch {
    return;
  }
}
function extractStartsWith(instance) {
  try {
    return instance.startsWith;
  } catch {
    return;
  }
}
function extractEndsWith(instance) {
  try {
    return instance.endsWith;
  } catch {
    return;
  }
}
function extractSubstring(instance) {
  try {
    return instance.substring;
  } catch {
    return;
  }
}
function extractToLowerCase(instance) {
  try {
    return instance.toLowerCase;
  } catch {
    return;
  }
}
function extractToUpperCase(instance) {
  try {
    return instance.toUpperCase;
  } catch {
    return;
  }
}
function extractPadStart(instance) {
  try {
    return instance.padStart;
  } catch {
    return;
  }
}
function extractCharCodeAt(instance) {
  try {
    return instance.charCodeAt;
  } catch {
    return;
  }
}
function extractNormalize(instance) {
  try {
    return instance.normalize;
  } catch (err) {
    return;
  }
}
function extractReplace(instance) {
  try {
    return instance.replace;
  } catch {
    return;
  }
}
function safeSplit(instance, ...args2) {
  if (extractSplit(instance) === untouchedSplit)
    return instance.split(...args2);
  return safeApply(untouchedSplit, instance, args2);
}
function safeStartsWith(instance, ...args2) {
  if (extractStartsWith(instance) === untouchedStartsWith)
    return instance.startsWith(...args2);
  return safeApply(untouchedStartsWith, instance, args2);
}
function safeEndsWith(instance, ...args2) {
  if (extractEndsWith(instance) === untouchedEndsWith)
    return instance.endsWith(...args2);
  return safeApply(untouchedEndsWith, instance, args2);
}
function safeSubstring(instance, ...args2) {
  if (extractSubstring(instance) === untouchedSubstring)
    return instance.substring(...args2);
  return safeApply(untouchedSubstring, instance, args2);
}
function safeToLowerCase(instance) {
  if (extractToLowerCase(instance) === untouchedToLowerCase)
    return instance.toLowerCase();
  return safeApply(untouchedToLowerCase, instance, []);
}
function safeToUpperCase(instance) {
  if (extractToUpperCase(instance) === untouchedToUpperCase)
    return instance.toUpperCase();
  return safeApply(untouchedToUpperCase, instance, []);
}
function safePadStart(instance, ...args2) {
  if (extractPadStart(instance) === untouchedPadStart)
    return instance.padStart(...args2);
  return safeApply(untouchedPadStart, instance, args2);
}
function safeCharCodeAt(instance, index2) {
  if (extractCharCodeAt(instance) === untouchedCharCodeAt)
    return instance.charCodeAt(index2);
  return safeApply(untouchedCharCodeAt, instance, [index2]);
}
function safeNormalize(instance, form) {
  if (extractNormalize(instance) === untouchedNormalize)
    return instance.normalize(form);
  return safeApply(untouchedNormalize, instance, [form]);
}
function safeReplace(instance, pattern, replacement) {
  if (extractReplace(instance) === untouchedReplace)
    return instance.replace(pattern, replacement);
  return safeApply(untouchedReplace, instance, [pattern, replacement]);
}
var untouchedNumberToString = Number.prototype.toString;
function extractNumberToString(instance) {
  try {
    return instance.toString;
  } catch {
    return;
  }
}
function safeNumberToString(instance, ...args2) {
  if (extractNumberToString(instance) === untouchedNumberToString)
    return instance.toString(...args2);
  return safeApply(untouchedNumberToString, instance, args2);
}
var untouchedHasOwnProperty = Object.prototype.hasOwnProperty;
var untouchedToString = Object.prototype.toString;
function safeHasOwnProperty(instance, v) {
  return safeApply(untouchedHasOwnProperty, instance, [v]);
}
function safeToString2(instance) {
  return safeApply(untouchedToString, instance, []);
}
var untouchedErrorToString = Error.prototype.toString;
function safeErrorToString(instance) {
  return safeApply(untouchedErrorToString, instance, []);
}
var LazyIterableIterator = class {
  constructor(producer) {
    this.producer = producer;
  }
  [Symbol.iterator]() {
    if (this.it === undefined)
      this.it = this.producer();
    return this.it;
  }
  next() {
    if (this.it === undefined)
      this.it = this.producer();
    return this.it.next();
  }
};
function makeLazy2(producer) {
  return new LazyIterableIterator(producer);
}
var safeArrayIsArray$4 = Array.isArray;
var safeObjectDefineProperty$3 = Object.defineProperty;
function tupleMakeItCloneable(vs, values2) {
  return safeObjectDefineProperty$3(vs, cloneMethod, { value: () => {
    const cloned = [];
    for (let idx = 0;idx !== values2.length; ++idx)
      safePush(cloned, values2[idx].value);
    tupleMakeItCloneable(cloned, values2);
    return cloned;
  } });
}
function tupleWrapper(values2) {
  let cloneable = false;
  const vs = [];
  const ctxs = [];
  for (let idx = 0;idx !== values2.length; ++idx) {
    const v = values2[idx];
    cloneable = cloneable || v.hasToBeCloned;
    safePush(vs, v.value);
    safePush(ctxs, v.context);
  }
  if (cloneable)
    tupleMakeItCloneable(vs, values2);
  return new Value(vs, ctxs);
}
function tupleShrink(arbs, value3, context2) {
  const shrinks = [];
  const safeContext = safeArrayIsArray$4(context2) ? context2 : [];
  for (let idx = 0;idx !== arbs.length; ++idx)
    safePush(shrinks, makeLazy2(() => arbs[idx].shrink(value3[idx], safeContext[idx]).map((v) => {
      const nextValues = safeMap(value3, (v2, idx2) => new Value(cloneIfNeeded(v2), safeContext[idx2]));
      return [
        ...safeSlice(nextValues, 0, idx),
        v,
        ...safeSlice(nextValues, idx + 1)
      ];
    }).map(tupleWrapper)));
  return Stream.nil().join(...shrinks);
}
var TupleArbitrary = class extends Arbitrary {
  constructor(arbs) {
    super();
    this.arbs = arbs;
    for (let idx = 0;idx !== arbs.length; ++idx) {
      const arb = arbs[idx];
      if (arb === null || arb === undefined || arb.generate === null || arb.generate === undefined)
        throw new Error(`Invalid parameter encountered at index ${idx}: expecting an Arbitrary`);
    }
  }
  generate(mrng, biasFactor) {
    const mapped = [];
    for (let idx = 0;idx !== this.arbs.length; ++idx)
      safePush(mapped, this.arbs[idx].generate(mrng, biasFactor));
    return tupleWrapper(mapped);
  }
  canShrinkWithoutContext(value3) {
    if (!safeArrayIsArray$4(value3) || value3.length !== this.arbs.length)
      return false;
    for (let index2 = 0;index2 !== this.arbs.length; ++index2)
      if (!this.arbs[index2].canShrinkWithoutContext(value3[index2]))
        return false;
    return true;
  }
  shrink(value3, context2) {
    return tupleShrink(this.arbs, value3, context2);
  }
};
function tuple2(...arbs) {
  return new TupleArbitrary(arbs);
}
var safeMathLog$3 = Math.log;
function runIdToFrequency(runId) {
  return 2 + ~~(safeMathLog$3(runId + 1) * 0.4342944819032518);
}
var globalParameters = {};
function configureGlobal(parameters) {
  globalParameters = parameters;
}
function readConfigureGlobal() {
  return globalParameters;
}
function resetConfigureGlobal() {
  globalParameters = {};
}
var UndefinedContextPlaceholder = Symbol("UndefinedContextPlaceholder");
function noUndefinedAsContext(value3) {
  if (value3.context !== undefined)
    return value3;
  if (value3.hasToBeCloned)
    return new Value(value3.value_, UndefinedContextPlaceholder, () => value3.value);
  return new Value(value3.value_, UndefinedContextPlaceholder);
}
var dummyHook$1 = () => {};
var AsyncProperty = class {
  constructor(arb, predicate) {
    this.arb = arb;
    this.predicate = predicate;
    const { asyncBeforeEach, asyncAfterEach, beforeEach, afterEach } = readConfigureGlobal() || {};
    if (asyncBeforeEach !== undefined && beforeEach !== undefined)
      throw SError(`Global "asyncBeforeEach" and "beforeEach" parameters can't be set at the same time when running async properties`);
    if (asyncAfterEach !== undefined && afterEach !== undefined)
      throw SError(`Global "asyncAfterEach" and "afterEach" parameters can't be set at the same time when running async properties`);
    this.beforeEachHook = asyncBeforeEach || beforeEach || dummyHook$1;
    this.afterEachHook = asyncAfterEach || afterEach || dummyHook$1;
  }
  isAsync() {
    return true;
  }
  generate(mrng, runId) {
    return noUndefinedAsContext(this.arb.generate(mrng, runId !== undefined ? runIdToFrequency(runId) : undefined));
  }
  shrink(value3) {
    if (value3.context === undefined && !this.arb.canShrinkWithoutContext(value3.value_))
      return Stream.nil();
    const safeContext = value3.context !== UndefinedContextPlaceholder ? value3.context : undefined;
    return this.arb.shrink(value3.value_, safeContext).map(noUndefinedAsContext);
  }
  async runBeforeEach() {
    await this.beforeEachHook();
  }
  async runAfterEach() {
    await this.afterEachHook();
  }
  async run(v) {
    try {
      const output = await this.predicate(v);
      return output === undefined || output === true ? null : { error: new SError("Property failed by returning false") };
    } catch (err) {
      if (PreconditionFailure.isFailure(err))
        return err;
      return { error: err };
    }
  }
  beforeEach(hookFunction) {
    const previousBeforeEachHook = this.beforeEachHook;
    this.beforeEachHook = () => hookFunction(previousBeforeEachHook);
    return this;
  }
  afterEach(hookFunction) {
    const previousAfterEachHook = this.afterEachHook;
    this.afterEachHook = () => hookFunction(previousAfterEachHook);
    return this;
  }
};
var AlwaysShrinkableArbitrary = class extends Arbitrary {
  constructor(arb) {
    super();
    this.arb = arb;
  }
  generate(mrng, biasFactor) {
    return noUndefinedAsContext(this.arb.generate(mrng, biasFactor));
  }
  canShrinkWithoutContext(_value) {
    return true;
  }
  shrink(value3, context2) {
    if (context2 === undefined && !this.arb.canShrinkWithoutContext(value3))
      return Stream.nil();
    const safeContext = context2 !== UndefinedContextPlaceholder ? context2 : undefined;
    return this.arb.shrink(value3, safeContext).map(noUndefinedAsContext);
  }
};
function asyncProperty(...args2) {
  if (args2.length < 2)
    throw new Error("asyncProperty expects at least two parameters");
  const arbs = safeSlice(args2, 0, args2.length - 1);
  const p = args2[args2.length - 1];
  safeForEach(arbs, assertIsArbitrary);
  return new AsyncProperty(tuple2(...safeMap(arbs, (arb) => new AlwaysShrinkableArbitrary(arb))), (t) => p(...t));
}
var dummyHook = () => {};
var Property = class {
  constructor(arb, predicate) {
    this.arb = arb;
    this.predicate = predicate;
    const { beforeEach = dummyHook, afterEach = dummyHook, asyncBeforeEach, asyncAfterEach } = readConfigureGlobal() || {};
    if (asyncBeforeEach !== undefined)
      throw SError(`"asyncBeforeEach" can't be set when running synchronous properties`);
    if (asyncAfterEach !== undefined)
      throw SError(`"asyncAfterEach" can't be set when running synchronous properties`);
    this.beforeEachHook = beforeEach;
    this.afterEachHook = afterEach;
  }
  isAsync() {
    return false;
  }
  generate(mrng, runId) {
    return noUndefinedAsContext(this.arb.generate(mrng, runId !== undefined ? runIdToFrequency(runId) : undefined));
  }
  shrink(value3) {
    if (value3.context === undefined && !this.arb.canShrinkWithoutContext(value3.value_))
      return Stream.nil();
    const safeContext = value3.context !== UndefinedContextPlaceholder ? value3.context : undefined;
    return this.arb.shrink(value3.value_, safeContext).map(noUndefinedAsContext);
  }
  runBeforeEach() {
    this.beforeEachHook();
  }
  runAfterEach() {
    this.afterEachHook();
  }
  run(v) {
    try {
      const output = this.predicate(v);
      return output === undefined || output === true ? null : { error: new SError("Property failed by returning false") };
    } catch (err) {
      if (PreconditionFailure.isFailure(err))
        return err;
      return { error: err };
    }
  }
  beforeEach(hookFunction) {
    const previousBeforeEachHook = this.beforeEachHook;
    this.beforeEachHook = () => hookFunction(previousBeforeEachHook);
    return this;
  }
  afterEach(hookFunction) {
    const previousAfterEachHook = this.afterEachHook;
    this.afterEachHook = () => hookFunction(previousAfterEachHook);
    return this;
  }
};
function property(...args2) {
  if (args2.length < 2)
    throw new Error("property expects at least two parameters");
  const arbs = safeSlice(args2, 0, args2.length - 1);
  const p = args2[args2.length - 1];
  safeForEach(arbs, assertIsArbitrary);
  return new Property(tuple2(...safeMap(arbs, (arb) => new AlwaysShrinkableArbitrary(arb))), (t) => p(...t));
}
var VerbosityLevel = /* @__PURE__ */ function(VerbosityLevel2) {
  VerbosityLevel2[VerbosityLevel2["None"] = 0] = "None";
  VerbosityLevel2[VerbosityLevel2["Verbose"] = 1] = "Verbose";
  VerbosityLevel2[VerbosityLevel2["VeryVerbose"] = 2] = "VeryVerbose";
  return VerbosityLevel2;
}({});
function adaptRandomGeneratorTo8x(rng) {
  if ("unsafeNext" in rng) {
    if (rng.unsafeJump === undefined)
      return {
        clone: () => adaptRandomGeneratorTo8x(rng),
        next: () => rng.unsafeNext(),
        getState: () => rng.getState()
      };
    return {
      clone: () => adaptRandomGeneratorTo8x(rng),
      next: () => rng.unsafeNext(),
      jump: () => rng.unsafeJump(),
      getState: () => rng.getState()
    };
  }
  return rng;
}
function adaptRandomGeneratorToInternal(rng) {
  if ("jump" in rng && typeof rng.jump === "function")
    return rng;
  return {
    clone: () => adaptRandomGeneratorToInternal(rng),
    next: () => rng.next(),
    jump: () => skipN(rng, 42),
    getState: () => rng.getState()
  };
}
function adaptRandomGenerator(rng) {
  return adaptRandomGeneratorToInternal(adaptRandomGeneratorTo8x(rng));
}
var safeDateNow$1 = Date.now;
var safeMathMin$6 = Math.min;
var safeMathRandom = Math.random;
var QualifiedParameters = class {
  constructor(op) {
    const p = op || {};
    this.seed = readSeed(p);
    this.randomType = readRandomType(p);
    this.numRuns = readNumRuns(p);
    this.verbose = readVerbose(p);
    this.maxSkipsPerRun = p.maxSkipsPerRun !== undefined ? p.maxSkipsPerRun : 100;
    this.timeout = safeTimeout(p.timeout);
    this.skipAllAfterTimeLimit = safeTimeout(p.skipAllAfterTimeLimit);
    this.interruptAfterTimeLimit = safeTimeout(p.interruptAfterTimeLimit);
    this.markInterruptAsFailure = p.markInterruptAsFailure === true;
    this.skipEqualValues = p.skipEqualValues === true;
    this.ignoreEqualValues = p.ignoreEqualValues === true;
    this.logger = p.logger !== undefined ? p.logger : (v) => {
      console.log(v);
    };
    this.path = p.path !== undefined ? p.path : "";
    this.unbiased = p.unbiased === true;
    this.examples = p.examples !== undefined ? p.examples : [];
    this.endOnFailure = p.endOnFailure === true;
    this.reporter = p.reporter;
    this.asyncReporter = p.asyncReporter;
    this.includeErrorInReport = p.includeErrorInReport === true;
  }
  toParameters() {
    return {
      seed: this.seed,
      randomType: this.randomType,
      numRuns: this.numRuns,
      maxSkipsPerRun: this.maxSkipsPerRun,
      timeout: this.timeout,
      skipAllAfterTimeLimit: this.skipAllAfterTimeLimit,
      interruptAfterTimeLimit: this.interruptAfterTimeLimit,
      markInterruptAsFailure: this.markInterruptAsFailure,
      skipEqualValues: this.skipEqualValues,
      ignoreEqualValues: this.ignoreEqualValues,
      path: this.path,
      logger: this.logger,
      unbiased: this.unbiased,
      verbose: this.verbose,
      examples: this.examples,
      endOnFailure: this.endOnFailure,
      reporter: this.reporter,
      asyncReporter: this.asyncReporter,
      includeErrorInReport: this.includeErrorInReport
    };
  }
};
function createQualifiedRandomGenerator(random2) {
  return (seed) => {
    return adaptRandomGenerator(random2(seed));
  };
}
function readSeed(p) {
  if (p.seed === undefined)
    return safeDateNow$1() ^ safeMathRandom() * 4294967296;
  const seed32 = p.seed | 0;
  if (p.seed === seed32)
    return seed32;
  return seed32 ^ (p.seed - seed32) * 4294967296;
}
function readRandomType(p) {
  if (p.randomType === undefined)
    return xorshift128plus;
  if (typeof p.randomType === "string")
    switch (p.randomType) {
      case "mersenne":
        return createQualifiedRandomGenerator(mersenne);
      case "congruential":
      case "congruential32":
        return createQualifiedRandomGenerator(congruential32);
      case "xorshift128plus":
        return xorshift128plus;
      case "xoroshiro128plus":
        return xoroshiro128plus;
      default:
        throw new Error(`Invalid random specified: '${p.randomType}'`);
    }
  const mrng = p.randomType(0);
  if ("min" in mrng && mrng.min !== -2147483648)
    throw new Error(`Invalid random number generator: min must equal -0x80000000, got ${String(mrng.min)}`);
  if ("max" in mrng && mrng.max !== 2147483647)
    throw new Error(`Invalid random number generator: max must equal 0x7fffffff, got ${String(mrng.max)}`);
  if (mrng === adaptRandomGenerator(mrng))
    return p.randomType;
  return createQualifiedRandomGenerator(p.randomType);
}
function readNumRuns(p) {
  const defaultValue = 100;
  if (p.numRuns !== undefined)
    return p.numRuns;
  if (p.num_runs !== undefined)
    return p.num_runs;
  return defaultValue;
}
function readVerbose(p) {
  if (p.verbose === undefined)
    return 0;
  if (typeof p.verbose === "boolean")
    return p.verbose === true ? 1 : 0;
  if (p.verbose <= 0)
    return 0;
  if (p.verbose >= 2)
    return 2;
  return p.verbose | 0;
}
function safeTimeout(value3) {
  if (value3 === undefined)
    return;
  return safeMathMin$6(value3, 2147483647);
}
function read(op) {
  return new QualifiedParameters(op);
}
function interruptAfter(timeMs, setTimeoutSafe, clearTimeoutSafe) {
  let timeoutHandle = null;
  return {
    clear: () => clearTimeoutSafe(timeoutHandle),
    promise: new Promise((resolve2) => {
      timeoutHandle = setTimeoutSafe(() => {
        resolve2(new PreconditionFailure(true));
      }, timeMs);
    })
  };
}
var SkipAfterProperty = class {
  constructor(property2, getTime, timeLimit, interruptExecution, setTimeoutSafe, clearTimeoutSafe) {
    this.property = property2;
    this.getTime = getTime;
    this.interruptExecution = interruptExecution;
    this.setTimeoutSafe = setTimeoutSafe;
    this.clearTimeoutSafe = clearTimeoutSafe;
    this.skipAfterTime = this.getTime() + timeLimit;
  }
  isAsync() {
    return this.property.isAsync();
  }
  generate(mrng, runId) {
    return this.property.generate(mrng, runId);
  }
  shrink(value3) {
    return this.property.shrink(value3);
  }
  run(v) {
    const remainingTime = this.skipAfterTime - this.getTime();
    if (remainingTime <= 0) {
      const preconditionFailure = new PreconditionFailure(this.interruptExecution);
      if (this.isAsync())
        return Promise.resolve(preconditionFailure);
      else
        return preconditionFailure;
    }
    if (this.interruptExecution && this.isAsync()) {
      const t = interruptAfter(remainingTime, this.setTimeoutSafe, this.clearTimeoutSafe);
      const propRun = Promise.race([this.property.run(v), t.promise]);
      propRun.then(t.clear, t.clear);
      return propRun;
    }
    return this.property.run(v);
  }
  runBeforeEach() {
    return this.property.runBeforeEach();
  }
  runAfterEach() {
    return this.property.runAfterEach();
  }
};
var timeoutAfter = (timeMs, setTimeoutSafe, clearTimeoutSafe) => {
  let timeoutHandle = null;
  return {
    clear: () => clearTimeoutSafe(timeoutHandle),
    promise: new Promise((resolve2) => {
      timeoutHandle = setTimeoutSafe(() => {
        resolve2({ error: new SError(`Property timeout: exceeded limit of ${timeMs} milliseconds`) });
      }, timeMs);
    })
  };
};
var TimeoutProperty = class {
  constructor(property2, timeMs, setTimeoutSafe, clearTimeoutSafe) {
    this.property = property2;
    this.timeMs = timeMs;
    this.setTimeoutSafe = setTimeoutSafe;
    this.clearTimeoutSafe = clearTimeoutSafe;
  }
  isAsync() {
    return true;
  }
  generate(mrng, runId) {
    return this.property.generate(mrng, runId);
  }
  shrink(value3) {
    return this.property.shrink(value3);
  }
  async run(v) {
    const t = timeoutAfter(this.timeMs, this.setTimeoutSafe, this.clearTimeoutSafe);
    const propRun = Promise.race([this.property.run(v), t.promise]);
    propRun.then(t.clear, t.clear);
    return propRun;
  }
  runBeforeEach() {
    return Promise.resolve(this.property.runBeforeEach());
  }
  runAfterEach() {
    return Promise.resolve(this.property.runAfterEach());
  }
};
var UnbiasedProperty = class {
  constructor(property2) {
    this.property = property2;
  }
  isAsync() {
    return this.property.isAsync();
  }
  generate(mrng, _runId) {
    return this.property.generate(mrng, undefined);
  }
  shrink(value3) {
    return this.property.shrink(value3);
  }
  run(v) {
    return this.property.run(v);
  }
  runBeforeEach() {
    return this.property.runBeforeEach();
  }
  runAfterEach() {
    return this.property.runAfterEach();
  }
};
var safeArrayFrom = Array.from;
var safeBufferIsBuffer = typeof Buffer !== "undefined" ? Buffer.isBuffer : undefined;
var safeJsonStringify$1 = JSON.stringify;
var safeNumberIsNaN$5 = Number.isNaN;
var safeObjectKeys$5 = Object.keys;
var safeObjectGetOwnPropertySymbols$2 = Object.getOwnPropertySymbols;
var safeObjectGetOwnPropertyDescriptor$3 = Object.getOwnPropertyDescriptor;
var safeObjectGetPrototypeOf$2 = Object.getPrototypeOf;
var safeNegativeInfinity$7 = Number.NEGATIVE_INFINITY;
var safePositiveInfinity$8 = Number.POSITIVE_INFINITY;
var toStringMethod = Symbol.for("fast-check/toStringMethod");
function hasToStringMethod(instance) {
  return instance !== null && (typeof instance === "object" || typeof instance === "function") && toStringMethod in instance && typeof instance[toStringMethod] === "function";
}
var asyncToStringMethod = Symbol.for("fast-check/asyncToStringMethod");
function hasAsyncToStringMethod(instance) {
  return instance !== null && (typeof instance === "object" || typeof instance === "function") && asyncToStringMethod in instance && typeof instance[asyncToStringMethod] === "function";
}
var findSymbolNameRegex = /^Symbol\((.*)\)$/;
function getSymbolDescription(s) {
  if (s.description !== undefined)
    return s.description;
  const m = findSymbolNameRegex.exec(SString(s));
  return m && m[1].length ? m[1] : null;
}
function stringifyNumber(numValue) {
  switch (numValue) {
    case 0:
      return 1 / numValue === safeNegativeInfinity$7 ? "-0" : "0";
    case safeNegativeInfinity$7:
      return "Number.NEGATIVE_INFINITY";
    case safePositiveInfinity$8:
      return "Number.POSITIVE_INFINITY";
    default:
      return numValue === numValue ? SString(numValue) : "Number.NaN";
  }
}
function isSparseArray(arr) {
  let previousNumberedIndex = -1;
  for (const index2 in arr) {
    const numberedIndex = Number(index2);
    if (numberedIndex !== previousNumberedIndex + 1)
      return true;
    previousNumberedIndex = numberedIndex;
  }
  return previousNumberedIndex + 1 !== arr.length;
}
function stringifyInternal(value3, previousValues, getAsyncContent) {
  const currentValues = [...previousValues, value3];
  if (typeof value3 === "object") {
    if (safeIndexOf(previousValues, value3) !== -1)
      return "[cyclic]";
  }
  if (hasAsyncToStringMethod(value3)) {
    const content = getAsyncContent(value3);
    if (content.state === "fulfilled")
      return content.value;
  }
  if (hasToStringMethod(value3))
    try {
      return value3[toStringMethod]();
    } catch {}
  switch (safeToString2(value3)) {
    case "[object Array]": {
      const arr = value3;
      if (arr.length >= 50 && isSparseArray(arr)) {
        const assignments = [];
        for (const index2 in arr)
          if (!safeNumberIsNaN$5(Number(index2)))
            safePush(assignments, `${index2}:${stringifyInternal(arr[index2], currentValues, getAsyncContent)}`);
        return assignments.length !== 0 ? `Object.assign(Array(${arr.length}),{${safeJoin(assignments, ",")}})` : `Array(${arr.length})`;
      }
      const stringifiedArray = safeJoin(safeMap(arr, (v) => stringifyInternal(v, currentValues, getAsyncContent)), ",");
      return arr.length === 0 || arr.length - 1 in arr ? `[${stringifiedArray}]` : `[${stringifiedArray},]`;
    }
    case "[object BigInt]":
      return `${value3}n`;
    case "[object Boolean]": {
      const unboxedToString = value3 == true ? "true" : "false";
      return typeof value3 === "boolean" ? unboxedToString : `new Boolean(${unboxedToString})`;
    }
    case "[object Date]": {
      const d = value3;
      return safeNumberIsNaN$5(safeGetTime(d)) ? `new Date(NaN)` : `new Date(${safeJsonStringify$1(safeToISOString(d))})`;
    }
    case "[object Map]":
      return `new Map(${stringifyInternal(Array.from(value3), currentValues, getAsyncContent)})`;
    case "[object Null]":
      return `null`;
    case "[object Number]":
      return typeof value3 === "number" ? stringifyNumber(value3) : `new Number(${stringifyNumber(Number(value3))})`;
    case "[object Object]": {
      try {
        const toStringAccessor = value3.toString;
        if (typeof toStringAccessor === "function" && toStringAccessor !== Object.prototype.toString)
          return value3.toString();
      } catch {
        return "[object Object]";
      }
      const mapper = (k) => `${k === "__proto__" ? '["__proto__"]' : typeof k === "symbol" ? `[${stringifyInternal(k, currentValues, getAsyncContent)}]` : safeJsonStringify$1(k)}:${stringifyInternal(value3[k], currentValues, getAsyncContent)}`;
      return "{" + safeJoin([
        ...safeObjectGetPrototypeOf$2(value3) === null ? ["__proto__:null"] : [],
        ...safeMap(safeObjectKeys$5(value3), mapper),
        ...safeMap(safeFilter(safeObjectGetOwnPropertySymbols$2(value3), (s) => {
          const descriptor = safeObjectGetOwnPropertyDescriptor$3(value3, s);
          return descriptor && descriptor.enumerable;
        }), mapper)
      ], ",") + "}";
    }
    case "[object Set]":
      return `new Set(${stringifyInternal(Array.from(value3), currentValues, getAsyncContent)})`;
    case "[object String]":
      return typeof value3 === "string" ? safeJsonStringify$1(value3) : `new String(${safeJsonStringify$1(value3)})`;
    case "[object Symbol]": {
      const s = value3;
      if (SSymbol.keyFor(s) !== undefined)
        return `Symbol.for(${safeJsonStringify$1(SSymbol.keyFor(s))})`;
      const desc = getSymbolDescription(s);
      if (desc === null)
        return "Symbol()";
      return s === (desc.startsWith("Symbol.") && SSymbol[desc.substring(7)]) ? desc : `Symbol(${safeJsonStringify$1(desc)})`;
    }
    case "[object Promise]": {
      const promiseContent = getAsyncContent(value3);
      switch (promiseContent.state) {
        case "fulfilled":
          return `Promise.resolve(${stringifyInternal(promiseContent.value, currentValues, getAsyncContent)})`;
        case "rejected":
          return `Promise.reject(${stringifyInternal(promiseContent.value, currentValues, getAsyncContent)})`;
        case "pending":
          return `new Promise(() => {/*pending*/})`;
        default:
          return `new Promise(() => {/*unknown*/})`;
      }
    }
    case "[object Error]":
      if (value3 instanceof Error)
        return `new Error(${stringifyInternal(value3.message, currentValues, getAsyncContent)})`;
      break;
    case "[object Undefined]":
      return `undefined`;
    case "[object Int8Array]":
    case "[object Uint8Array]":
    case "[object Uint8ClampedArray]":
    case "[object Int16Array]":
    case "[object Uint16Array]":
    case "[object Int32Array]":
    case "[object Uint32Array]":
    case "[object Float32Array]":
    case "[object Float64Array]":
    case "[object BigInt64Array]":
    case "[object BigUint64Array]": {
      if (typeof safeBufferIsBuffer === "function" && safeBufferIsBuffer(value3))
        return `Buffer.from(${value3.buffer.detached ? "/*detached ArrayBuffer*/" : stringifyInternal(safeArrayFrom(value3.values()), currentValues, getAsyncContent)})`;
      const valuePrototype = safeObjectGetPrototypeOf$2(value3);
      const className = valuePrototype && valuePrototype.constructor && valuePrototype.constructor.name;
      if (typeof className === "string") {
        const typedArray = value3;
        if (typedArray.buffer.detached)
          return `${className}.from(/*detached ArrayBuffer*/)`;
        return `${className}.from(${stringifyInternal(safeArrayFrom(typedArray.values()), currentValues, getAsyncContent)})`;
      }
      break;
    }
  }
  try {
    return value3.toString();
  } catch {
    return safeToString2(value3);
  }
}
function stringify(value3) {
  return stringifyInternal(value3, [], () => ({
    state: "unknown",
    value: undefined
  }));
}
function possiblyAsyncStringify(value3) {
  const stillPendingMarker = SSymbol();
  const pendingPromisesForCache = [];
  const cache = new SMap$1;
  function createDelay0() {
    let handleId = null;
    const cancel = () => {
      if (handleId !== null)
        clearTimeout(handleId);
    };
    return {
      delay: new Promise((resolve2) => {
        handleId = setTimeout(() => {
          handleId = null;
          resolve2(stillPendingMarker);
        }, 0);
      }),
      cancel
    };
  }
  const unknownState = {
    state: "unknown",
    value: undefined
  };
  const getAsyncContent = function getAsyncContent2(data) {
    const cacheKey = data;
    if (cache.has(cacheKey))
      return cache.get(cacheKey);
    const delay0 = createDelay0();
    const p = asyncToStringMethod in data ? Promise.resolve().then(() => data[asyncToStringMethod]()) : data;
    p.catch(() => {});
    pendingPromisesForCache.push(Promise.race([p, delay0.delay]).then((successValue) => {
      if (successValue === stillPendingMarker)
        cache.set(cacheKey, {
          state: "pending",
          value: undefined
        });
      else
        cache.set(cacheKey, {
          state: "fulfilled",
          value: successValue
        });
      delay0.cancel();
    }, (errorValue) => {
      cache.set(cacheKey, {
        state: "rejected",
        value: errorValue
      });
      delay0.cancel();
    }));
    cache.set(cacheKey, unknownState);
    return unknownState;
  };
  function loop() {
    const stringifiedValue = stringifyInternal(value3, [], getAsyncContent);
    if (pendingPromisesForCache.length === 0)
      return stringifiedValue;
    return Promise.all(pendingPromisesForCache.splice(0)).then(loop);
  }
  return loop();
}
async function asyncStringify(value3) {
  return Promise.resolve(possiblyAsyncStringify(value3));
}
function fromSyncCached(cachedValue) {
  return cachedValue === null ? new PreconditionFailure : cachedValue;
}
function fromCached(...data) {
  if (data[1])
    return data[0].then(fromSyncCached);
  return fromSyncCached(data[0]);
}
function fromCachedUnsafe(cachedValue, isAsync) {
  return fromCached(cachedValue, isAsync);
}
var IgnoreEqualValuesProperty = class {
  constructor(property2, skipRuns) {
    this.property = property2;
    this.skipRuns = skipRuns;
    this.coveredCases = /* @__PURE__ */ new Map;
  }
  isAsync() {
    return this.property.isAsync();
  }
  generate(mrng, runId) {
    return this.property.generate(mrng, runId);
  }
  shrink(value3) {
    return this.property.shrink(value3);
  }
  run(v) {
    const stringifiedValue = stringify(v);
    if (this.coveredCases.has(stringifiedValue)) {
      const lastOutput = this.coveredCases.get(stringifiedValue);
      if (!this.skipRuns)
        return lastOutput;
      return fromCachedUnsafe(lastOutput, this.property.isAsync());
    }
    const out = this.property.run(v);
    this.coveredCases.set(stringifiedValue, out);
    return out;
  }
  runBeforeEach() {
    return this.property.runBeforeEach();
  }
  runAfterEach() {
    return this.property.runAfterEach();
  }
};
var safeDateNow = Date.now;
var safeSetTimeout = setTimeout;
var safeClearTimeout = clearTimeout;
function decorateProperty(rawProperty, qParams) {
  let prop = rawProperty;
  if (rawProperty.isAsync() && qParams.timeout !== undefined)
    prop = new TimeoutProperty(prop, qParams.timeout, safeSetTimeout, safeClearTimeout);
  if (qParams.unbiased)
    prop = new UnbiasedProperty(prop);
  if (qParams.skipAllAfterTimeLimit !== undefined)
    prop = new SkipAfterProperty(prop, safeDateNow, qParams.skipAllAfterTimeLimit, false, safeSetTimeout, safeClearTimeout);
  if (qParams.interruptAfterTimeLimit !== undefined)
    prop = new SkipAfterProperty(prop, safeDateNow, qParams.interruptAfterTimeLimit, true, safeSetTimeout, safeClearTimeout);
  if (qParams.skipEqualValues)
    prop = new IgnoreEqualValuesProperty(prop, true);
  if (qParams.ignoreEqualValues)
    prop = new IgnoreEqualValuesProperty(prop, false);
  return prop;
}
var ExecutionStatus = /* @__PURE__ */ function(ExecutionStatus2) {
  ExecutionStatus2[ExecutionStatus2["Success"] = 0] = "Success";
  ExecutionStatus2[ExecutionStatus2["Skipped"] = -1] = "Skipped";
  ExecutionStatus2[ExecutionStatus2["Failure"] = 1] = "Failure";
  return ExecutionStatus2;
}({});
var RunExecution = class RunExecution2 {
  constructor(verbosity, interruptedAsFailure) {
    this.verbosity = verbosity;
    this.interruptedAsFailure = interruptedAsFailure;
    this.rootExecutionTrees = [];
    this.currentLevelExecutionTrees = this.rootExecutionTrees;
    this.failure = null;
    this.numSkips = 0;
    this.numSuccesses = 0;
    this.interrupted = false;
  }
  appendExecutionTree(status, value3) {
    const currentTree = {
      status,
      value: value3,
      children: []
    };
    this.currentLevelExecutionTrees.push(currentTree);
    return currentTree;
  }
  fail(value3, id2, failure) {
    if (this.verbosity >= 1) {
      const currentTree = this.appendExecutionTree(1, value3);
      this.currentLevelExecutionTrees = currentTree.children;
    }
    if (this.pathToFailure === undefined)
      this.pathToFailure = `${id2}`;
    else
      this.pathToFailure += `:${id2}`;
    this.value = value3;
    this.failure = failure;
  }
  skip(value3) {
    if (this.verbosity >= 2)
      this.appendExecutionTree(-1, value3);
    if (this.pathToFailure === undefined)
      ++this.numSkips;
  }
  success(value3) {
    if (this.verbosity >= 2)
      this.appendExecutionTree(0, value3);
    if (this.pathToFailure === undefined)
      ++this.numSuccesses;
  }
  interrupt() {
    this.interrupted = true;
  }
  isSuccess() {
    return this.pathToFailure === undefined;
  }
  firstFailure() {
    return this.pathToFailure !== undefined ? +safeSplit(this.pathToFailure, ":")[0] : -1;
  }
  numShrinks() {
    return this.pathToFailure !== undefined ? safeSplit(this.pathToFailure, ":").length - 1 : 0;
  }
  extractFailures() {
    if (this.isSuccess())
      return [];
    const failures = [];
    let cursor = this.rootExecutionTrees;
    while (cursor.length > 0 && cursor[cursor.length - 1].status === 1) {
      const failureTree = cursor[cursor.length - 1];
      failures.push(failureTree.value);
      cursor = failureTree.children;
    }
    return failures;
  }
  static mergePaths(offsetPath, path) {
    if (offsetPath.length === 0)
      return path;
    const offsetItems = offsetPath.split(":");
    const remainingItems = path.split(":");
    const middle = +offsetItems[offsetItems.length - 1] + +remainingItems[0];
    return [
      ...offsetItems.slice(0, offsetItems.length - 1),
      `${middle}`,
      ...remainingItems.slice(1)
    ].join(":");
  }
  toRunDetails(seed, basePath, maxSkips, qParams) {
    if (!this.isSuccess())
      return {
        failed: true,
        interrupted: this.interrupted,
        numRuns: this.firstFailure() + 1 - this.numSkips,
        numSkips: this.numSkips,
        numShrinks: this.numShrinks(),
        seed,
        counterexample: this.value,
        counterexamplePath: RunExecution2.mergePaths(basePath, this.pathToFailure),
        errorInstance: this.failure.error,
        failures: this.extractFailures(),
        executionSummary: this.rootExecutionTrees,
        verbose: this.verbosity,
        runConfiguration: qParams.toParameters()
      };
    const considerInterruptedAsFailure = this.interruptedAsFailure || this.numSuccesses === 0;
    return {
      failed: this.numSkips > maxSkips || this.interrupted && considerInterruptedAsFailure,
      interrupted: this.interrupted,
      numRuns: this.numSuccesses,
      numSkips: this.numSkips,
      numShrinks: 0,
      seed,
      counterexample: null,
      counterexamplePath: null,
      error: null,
      errorInstance: null,
      failures: [],
      executionSummary: this.rootExecutionTrees,
      verbose: this.verbosity,
      runConfiguration: qParams.toParameters()
    };
  }
};
var RunnerIterator = class {
  constructor(sourceValues, shrink, verbose, interruptedAsFailure) {
    this.sourceValues = sourceValues;
    this.shrink = shrink;
    this.runExecution = new RunExecution(verbose, interruptedAsFailure);
    this.currentIdx = -1;
    this.nextValues = sourceValues;
  }
  [Symbol.iterator]() {
    return this;
  }
  next() {
    const nextValue = this.nextValues.next();
    if (nextValue.done || this.runExecution.interrupted)
      return {
        done: true,
        value: undefined
      };
    this.currentValue = nextValue.value;
    ++this.currentIdx;
    return {
      done: false,
      value: nextValue.value.value_
    };
  }
  handleResult(result2) {
    if (result2 !== null && typeof result2 === "object" && !PreconditionFailure.isFailure(result2)) {
      this.runExecution.fail(this.currentValue.value_, this.currentIdx, result2);
      this.currentIdx = -1;
      this.nextValues = this.shrink(this.currentValue);
    } else if (result2 !== null)
      if (!result2.interruptExecution) {
        this.runExecution.skip(this.currentValue.value_);
        this.sourceValues.skippedOne();
      } else
        this.runExecution.interrupt();
    else
      this.runExecution.success(this.currentValue.value_);
  }
};
var SourceValuesIterator = class {
  constructor(initialValues, maxInitialIterations, remainingSkips) {
    this.initialValues = initialValues;
    this.maxInitialIterations = maxInitialIterations;
    this.remainingSkips = remainingSkips;
  }
  [Symbol.iterator]() {
    return this;
  }
  next() {
    if (--this.maxInitialIterations !== -1 && this.remainingSkips >= 0) {
      const n = this.initialValues.next();
      if (!n.done)
        return {
          value: n.value,
          done: false
        };
    }
    return {
      value: undefined,
      done: true
    };
  }
  skippedOne() {
    --this.remainingSkips;
    ++this.maxInitialIterations;
  }
};
var MIN_INT = -2147483648;
var MAX_INT = 2147483647;
var DBL_FACTOR = Math.pow(2, 27);
var DBL_DIVISOR = Math.pow(2, -53);
var Random = class Random2 {
  constructor(sourceRng) {
    this.internalRng = adaptRandomGenerator(sourceRng.clone());
  }
  clone() {
    return new Random2(this.internalRng);
  }
  next(bits) {
    return uniformInt(this.internalRng, 0, (1 << bits) - 1);
  }
  nextBoolean() {
    return uniformInt(this.internalRng, 0, 1) === 1;
  }
  nextInt(min4, max4) {
    return uniformInt(this.internalRng, min4 === undefined ? MIN_INT : min4, max4 === undefined ? MAX_INT : max4);
  }
  nextBigInt(min4, max4) {
    return uniformBigInt(this.internalRng, min4, max4);
  }
  nextDouble() {
    const a = this.next(26);
    const b = this.next(27);
    return (a * DBL_FACTOR + b) * DBL_DIVISOR;
  }
  getState() {
    if ("getState" in this.internalRng && typeof this.internalRng.getState === "function")
      return this.internalRng.getState();
  }
};
function tossNext(generator, rng, index2) {
  rng.jump();
  return generator.generate(new Random(rng), index2);
}
function* toss(generator, seed, random2, examples) {
  for (let idx = 0;idx !== examples.length; ++idx)
    yield new Value(examples[idx], undefined);
  for (let idx = 0, rng = random2(seed);; ++idx)
    yield tossNext(generator, rng, idx);
}
function lazyGenerate(generator, rng, idx) {
  return () => generator.generate(new Random(rng), idx);
}
function* lazyToss(generator, seed, random2, examples) {
  yield* safeMap(examples, (e) => () => new Value(e, undefined));
  let idx = 0;
  const rng = adaptRandomGenerator(random2(seed));
  for (;; ) {
    rng.jump();
    yield lazyGenerate(generator, rng, idx++);
  }
}
function produce(producer) {
  return producer();
}
function pathWalk(path, initialProducers, shrink) {
  const producers = initialProducers;
  const segments = path.split(":").map((text) => +text);
  if (segments.length === 0)
    return producers.map(produce);
  if (!segments.every((v) => !Number.isNaN(v)))
    throw new Error(`Unable to replay, got invalid path=${path}`);
  let values2 = producers.drop(segments[0]).map(produce);
  for (const s of segments.slice(1)) {
    const valueToShrink = values2.getNthOrLast(0);
    if (valueToShrink === null)
      throw new Error(`Unable to replay, got wrong path=${path}`);
    values2 = shrink(valueToShrink).drop(s);
  }
  return values2;
}
var safeObjectAssign$5 = Object.assign;
function formatHints(hints) {
  if (hints.length === 1)
    return `Hint: ${hints[0]}`;
  return hints.map((h, idx) => `Hint (${idx + 1}): ${h}`).join(`
`);
}
function formatFailures(failures, stringifyOne) {
  return `Encountered failures were:
- ${failures.map(stringifyOne).join(`
- `)}`;
}
function formatExecutionSummary(executionTrees, stringifyOne) {
  const summaryLines = [];
  const remainingTreesAndDepth = [];
  for (let i = executionTrees.length - 1;i >= 0; --i)
    remainingTreesAndDepth.push({
      depth: 1,
      tree: executionTrees[i]
    });
  while (remainingTreesAndDepth.length !== 0) {
    const currentTreeAndDepth = remainingTreesAndDepth.pop();
    const currentTree = currentTreeAndDepth.tree;
    const currentDepth = currentTreeAndDepth.depth;
    const statusIcon = currentTree.status === 0 ? "\x1B[32m\u221A\x1B[0m" : currentTree.status === 1 ? "\x1B[31m\xD7\x1B[0m" : "\x1B[33m!\x1B[0m";
    const leftPadding = currentDepth !== 0 ? ". ".repeat(currentDepth - 1) : "";
    summaryLines.push(`${leftPadding}${statusIcon} ${stringifyOne(currentTree.value)}`);
    for (let i = currentTree.children.length - 1;i >= 0; --i)
      remainingTreesAndDepth.push({
        depth: currentDepth + 1,
        tree: currentTree.children[i]
      });
  }
  return `Execution summary:
${summaryLines.join(`
`)}`;
}
function preFormatTooManySkipped(out, stringifyOne) {
  const message = `Failed to run property, too many pre-condition failures encountered
{ seed: ${out.seed} }

Ran ${out.numRuns} time(s)
Skipped ${out.numSkips} time(s)`;
  let details = null;
  const hints = ["Try to reduce the number of rejected values by combining map, chain and built-in arbitraries", "Increase failure tolerance by setting maxSkipsPerRun to an higher value"];
  if (out.verbose >= 2)
    details = formatExecutionSummary(out.executionSummary, stringifyOne);
  else
    safePush(hints, "Enable verbose mode at level VeryVerbose in order to check all generated values and their associated status");
  return {
    message,
    details,
    hints
  };
}
function prettyError(errorInstance) {
  if (errorInstance instanceof SError && errorInstance.stack !== undefined)
    return errorInstance.stack;
  try {
    return SString(errorInstance);
  } catch (_err) {}
  if (errorInstance instanceof SError)
    try {
      return safeErrorToString(errorInstance);
    } catch (_err) {}
  if (errorInstance !== null && typeof errorInstance === "object")
    try {
      return safeToString2(errorInstance);
    } catch (_err) {}
  return "Failed to serialize errorInstance";
}
function preFormatFailure(out, stringifyOne) {
  const messageErrorPart = out.runConfiguration.includeErrorInReport ? `
Got ${safeReplace(prettyError(out.errorInstance), /^Error: /, "error: ")}` : "";
  const message = `Property failed after ${out.numRuns} tests
{ seed: ${out.seed}, path: "${out.counterexamplePath}", endOnFailure: true }
Counterexample: ${stringifyOne(out.counterexample)}
Shrunk ${out.numShrinks} time(s)${messageErrorPart}`;
  let details = null;
  const hints = [];
  if (out.verbose >= 2)
    details = formatExecutionSummary(out.executionSummary, stringifyOne);
  else if (out.verbose === 1)
    details = formatFailures(out.failures, stringifyOne);
  else
    safePush(hints, "Enable verbose mode in order to have the list of all failing values encountered during the run");
  return {
    message,
    details,
    hints
  };
}
function preFormatEarlyInterrupted(out, stringifyOne) {
  const message = `Property interrupted after ${out.numRuns} tests
{ seed: ${out.seed} }`;
  let details = null;
  const hints = [];
  if (out.verbose >= 2)
    details = formatExecutionSummary(out.executionSummary, stringifyOne);
  else
    safePush(hints, "Enable verbose mode at level VeryVerbose in order to check all generated values and their associated status");
  return {
    message,
    details,
    hints
  };
}
function defaultReportMessageInternal(out, stringifyOne) {
  if (!out.failed)
    return;
  const { message, details, hints } = out.counterexamplePath === null ? out.interrupted ? preFormatEarlyInterrupted(out, stringifyOne) : preFormatTooManySkipped(out, stringifyOne) : preFormatFailure(out, stringifyOne);
  let errorMessage = message;
  if (details !== null)
    errorMessage += `

${details}`;
  if (hints.length > 0)
    errorMessage += `

${formatHints(hints)}`;
  return errorMessage;
}
function defaultReportMessage(out) {
  return defaultReportMessageInternal(out, stringify);
}
async function asyncDefaultReportMessage(out) {
  const pendingStringifieds = [];
  function stringifyOne(value3) {
    const stringified = possiblyAsyncStringify(value3);
    if (typeof stringified === "string")
      return stringified;
    pendingStringifieds.push(Promise.all([value3, stringified]));
    return "\u2026";
  }
  const firstTryMessage = defaultReportMessageInternal(out, stringifyOne);
  if (pendingStringifieds.length === 0)
    return firstTryMessage;
  const registeredValues = new SMap$1(await Promise.all(pendingStringifieds));
  function stringifySecond(value3) {
    const asyncStringifiedIfRegistered = safeMapGet(registeredValues, value3);
    if (asyncStringifiedIfRegistered !== undefined)
      return asyncStringifiedIfRegistered;
    return stringify(value3);
  }
  return defaultReportMessageInternal(out, stringifySecond);
}
function buildError(errorMessage, out) {
  if (out.runConfiguration.includeErrorInReport)
    throw new SError(errorMessage);
  const error = new SError(errorMessage, { cause: out.errorInstance });
  if (!("cause" in error))
    safeObjectAssign$5(error, { cause: out.errorInstance });
  return error;
}
function throwIfFailed(out) {
  if (!out.failed)
    return;
  throw buildError(defaultReportMessage(out), out);
}
async function asyncThrowIfFailed(out) {
  if (!out.failed)
    return;
  throw buildError(await asyncDefaultReportMessage(out), out);
}
function reportRunDetails(out) {
  if (out.runConfiguration.asyncReporter)
    return out.runConfiguration.asyncReporter(out);
  else if (out.runConfiguration.reporter)
    return out.runConfiguration.reporter(out);
  else
    return throwIfFailed(out);
}
async function asyncReportRunDetails(out) {
  if (out.runConfiguration.asyncReporter)
    return out.runConfiguration.asyncReporter(out);
  else if (out.runConfiguration.reporter)
    return out.runConfiguration.reporter(out);
  else
    return asyncThrowIfFailed(out);
}
function runIt(property2, shrink, sourceValues, verbose, interruptedAsFailure) {
  const runner = new RunnerIterator(sourceValues, shrink, verbose, interruptedAsFailure);
  for (const v of runner) {
    property2.runBeforeEach();
    const out = property2.run(v);
    property2.runAfterEach();
    runner.handleResult(out);
  }
  return runner.runExecution;
}
async function asyncRunIt(property2, shrink, sourceValues, verbose, interruptedAsFailure) {
  const runner = new RunnerIterator(sourceValues, shrink, verbose, interruptedAsFailure);
  for (const v of runner) {
    await property2.runBeforeEach();
    const out = await property2.run(v);
    await property2.runAfterEach();
    runner.handleResult(out);
  }
  return runner.runExecution;
}
function check(rawProperty, params) {
  if (rawProperty === null || rawProperty === undefined || rawProperty.generate === null || rawProperty.generate === undefined)
    throw new Error("Invalid property encountered, please use a valid property");
  if (rawProperty.run === null || rawProperty.run === undefined)
    throw new Error("Invalid property encountered, please use a valid property not an arbitrary");
  const qParams = read({
    ...readConfigureGlobal(),
    ...params
  });
  if (qParams.reporter !== undefined && qParams.asyncReporter !== undefined)
    throw new Error("Invalid parameters encountered, reporter and asyncReporter cannot be specified together");
  if (qParams.asyncReporter !== undefined && !rawProperty.isAsync())
    throw new Error("Invalid parameters encountered, only asyncProperty can be used when asyncReporter specified");
  const property2 = decorateProperty(rawProperty, qParams);
  const maxInitialIterations = qParams.path.length === 0 || qParams.path.indexOf(":") === -1 ? qParams.numRuns : -1;
  const maxSkips = qParams.numRuns * qParams.maxSkipsPerRun;
  const shrink = (...args2) => property2.shrink(...args2);
  const sourceValues = new SourceValuesIterator(qParams.path.length === 0 ? toss(property2, qParams.seed, qParams.randomType, qParams.examples) : pathWalk(qParams.path, stream(lazyToss(property2, qParams.seed, qParams.randomType, qParams.examples)), shrink), maxInitialIterations, maxSkips);
  const finalShrink = !qParams.endOnFailure ? shrink : Stream.nil;
  return property2.isAsync() ? asyncRunIt(property2, finalShrink, sourceValues, qParams.verbose, qParams.markInterruptAsFailure).then((e) => e.toRunDetails(qParams.seed, qParams.path, maxSkips, qParams)) : runIt(property2, finalShrink, sourceValues, qParams.verbose, qParams.markInterruptAsFailure).toRunDetails(qParams.seed, qParams.path, maxSkips, qParams);
}
function assert(property2, params) {
  const out = check(property2, params);
  if (property2.isAsync())
    return out.then(asyncReportRunDetails);
  else
    reportRunDetails(out);
}
function toProperty(generator, qParams) {
  const prop = !Object.prototype.hasOwnProperty.call(generator, "isAsync") ? new Property(generator, () => true) : generator;
  return qParams.unbiased === true ? new UnbiasedProperty(prop) : prop;
}
function streamSample(generator, params) {
  const qParams = read(typeof params === "number" ? {
    ...readConfigureGlobal(),
    numRuns: params
  } : {
    ...readConfigureGlobal(),
    ...params
  });
  const nextProperty = toProperty(generator, qParams);
  const shrink = nextProperty.shrink.bind(nextProperty);
  return (qParams.path.length === 0 ? stream(toss(nextProperty, qParams.seed, qParams.randomType, qParams.examples)) : pathWalk(qParams.path, stream(lazyToss(nextProperty, qParams.seed, qParams.randomType, qParams.examples)), shrink)).take(qParams.numRuns).map((s) => s.value_);
}
function sample(generator, params) {
  return [...streamSample(generator, params)];
}
function round2(n) {
  return (Math.round(n * 100) / 100).toFixed(2);
}
function statistics(generator, classify, params) {
  const qParams = read(typeof params === "number" ? {
    ...readConfigureGlobal(),
    numRuns: params
  } : {
    ...readConfigureGlobal(),
    ...params
  });
  const recorded = {};
  for (const g of streamSample(generator, params)) {
    const out = classify(g);
    const categories = Array.isArray(out) ? out : [out];
    for (const c of categories)
      recorded[c] = (recorded[c] || 0) + 1;
  }
  const data = Object.entries(recorded).sort((a, b) => b[1] - a[1]).map((i) => [i[0], `${round2(i[1] * 100 / qParams.numRuns)}%`]);
  const longestName = data.map((i) => i[0].length).reduce((p, c) => Math.max(p, c), 0);
  const longestPercent = data.map((i) => i[1].length).reduce((p, c) => Math.max(p, c), 0);
  for (const item of data)
    qParams.logger(`${item[0].padEnd(longestName, ".")}..${item[1].padStart(longestPercent, ".")}`);
}
var safeObjectAssign$4 = Object.assign;
function buildGeneratorValue(mrng, biasFactor, computePreBuiltValues, arbitraryCache) {
  const preBuiltValues = computePreBuiltValues();
  let localMrng = mrng.clone();
  const context2 = {
    mrng: mrng.clone(),
    biasFactor,
    history: []
  };
  const valueFunction = (arb) => {
    const preBuiltValue = preBuiltValues[context2.history.length];
    if (preBuiltValue !== undefined && preBuiltValue.arb === arb) {
      const value3 = preBuiltValue.value;
      safePush(context2.history, {
        arb,
        value: value3,
        context: preBuiltValue.context,
        mrng: preBuiltValue.mrng
      });
      localMrng = preBuiltValue.mrng.clone();
      return value3;
    }
    const g = arb.generate(localMrng, biasFactor);
    safePush(context2.history, {
      arb,
      value: g.value_,
      context: g.context,
      mrng: localMrng.clone()
    });
    return g.value;
  };
  const memoedValueFunction = (arb, ...args2) => {
    return valueFunction(arbitraryCache(arb, args2));
  };
  return new Value(safeObjectAssign$4(memoedValueFunction, {
    values() {
      return safeMap(context2.history, (c) => c.value);
    },
    [cloneMethod]() {
      return buildGeneratorValue(mrng, biasFactor, computePreBuiltValues, arbitraryCache).value;
    },
    [toStringMethod]() {
      return stringify(safeMap(context2.history, (c) => c.value));
    }
  }), context2);
}
var safeArrayIsArray$3 = Array.isArray;
var safeObjectKeys$4 = Object.keys;
var safeObjectIs$7 = Object.is;
function buildStableArbitraryGeneratorCache(isEqual2) {
  const previousCallsPerBuilder = new SMap$1;
  return function stableArbitraryGeneratorCache(builder, args2) {
    const entriesForBuilder = safeMapGet(previousCallsPerBuilder, builder);
    if (entriesForBuilder === undefined) {
      const newValue2 = builder(...args2);
      safeMapSet(previousCallsPerBuilder, builder, [{
        args: args2,
        value: newValue2
      }]);
      return newValue2;
    }
    const safeEntriesForBuilder = entriesForBuilder;
    for (const entry of safeEntriesForBuilder)
      if (isEqual2(args2, entry.args))
        return entry.value;
    const newValue = builder(...args2);
    safePush(safeEntriesForBuilder, {
      args: args2,
      value: newValue
    });
    return newValue;
  };
}
function naiveIsEqual(v1, v2) {
  if (v1 !== null && typeof v1 === "object" && v2 !== null && typeof v2 === "object") {
    if (safeArrayIsArray$3(v1)) {
      if (!safeArrayIsArray$3(v2))
        return false;
      if (v1.length !== v2.length)
        return false;
    } else if (safeArrayIsArray$3(v2))
      return false;
    if (safeObjectKeys$4(v1).length !== safeObjectKeys$4(v2).length)
      return false;
    for (const index2 in v1) {
      if (!(index2 in v2))
        return false;
      if (!naiveIsEqual(v1[index2], v2[index2]))
        return false;
    }
    return true;
  } else
    return safeObjectIs$7(v1, v2);
}
var GeneratorArbitrary = class extends Arbitrary {
  constructor(..._args) {
    super(..._args);
    this.arbitraryCache = buildStableArbitraryGeneratorCache(naiveIsEqual);
  }
  generate(mrng, biasFactor) {
    return buildGeneratorValue(mrng, biasFactor, () => [], this.arbitraryCache);
  }
  canShrinkWithoutContext(_value) {
    return false;
  }
  shrink(_value, context2) {
    if (context2 === undefined)
      return Stream.nil();
    const safeContext = context2;
    const mrng = safeContext.mrng;
    const biasFactor = safeContext.biasFactor;
    const history = safeContext.history;
    return tupleShrink(history.map((c) => c.arb), history.map((c) => c.value), history.map((c) => c.context)).map((shrink) => {
      function computePreBuiltValues() {
        const subValues = shrink.value;
        const subContexts = shrink.context;
        return safeMap(history, (entry, index2) => ({
          arb: entry.arb,
          value: subValues[index2],
          context: subContexts[index2],
          mrng: entry.mrng
        }));
      }
      return buildGeneratorValue(mrng, biasFactor, computePreBuiltValues, this.arbitraryCache);
    });
  }
};
function gen2() {
  return new GeneratorArbitrary;
}
var safeMathFloor$6 = Math.floor;
var safeMathLog$2 = Math.log;
function integerLogLike(v) {
  return safeMathFloor$6(safeMathLog$2(v) / safeMathLog$2(2));
}
function bigIntLogLike(v) {
  if (v === SBigInt2(0))
    return SBigInt2(0);
  return SBigInt2(SString(v).length);
}
function biasNumericRange(min4, max4, logLike) {
  if (min4 === max4)
    return [{
      min: min4,
      max: max4
    }];
  if (min4 < 0 && max4 > 0) {
    const logMin = logLike(-min4);
    const logMax = logLike(max4);
    return [
      {
        min: -logMin,
        max: logMax
      },
      {
        min: max4 - logMax,
        max: max4
      },
      {
        min: min4,
        max: min4 + logMin
      }
    ];
  }
  const logGap = logLike(max4 - min4);
  const arbCloseToMin = {
    min: min4,
    max: min4 + logGap
  };
  const arbCloseToMax = {
    min: max4 - logGap,
    max: max4
  };
  return min4 < 0 ? [arbCloseToMax, arbCloseToMin] : [arbCloseToMin, arbCloseToMax];
}
var safeMathCeil = Math.ceil;
var safeMathFloor$5 = Math.floor;
function halvePosInteger(n) {
  return safeMathFloor$5(n / 2);
}
function halveNegInteger(n) {
  return safeMathCeil(n / 2);
}
function shrinkInteger(current, target, tryTargetAsap) {
  const realGap = current - target;
  function* shrinkDecr() {
    let previous = tryTargetAsap ? undefined : target;
    const gap = tryTargetAsap ? realGap : halvePosInteger(realGap);
    for (let toremove = gap;toremove > 0; toremove = halvePosInteger(toremove)) {
      const next = toremove === realGap ? target : current - toremove;
      yield new Value(next, previous);
      previous = next;
    }
  }
  function* shrinkIncr() {
    let previous = tryTargetAsap ? undefined : target;
    const gap = tryTargetAsap ? realGap : halveNegInteger(realGap);
    for (let toremove = gap;toremove < 0; toremove = halveNegInteger(toremove)) {
      const next = toremove === realGap ? target : current - toremove;
      yield new Value(next, previous);
      previous = next;
    }
  }
  return realGap > 0 ? stream(shrinkDecr()) : stream(shrinkIncr());
}
var safeMathSign = Math.sign;
var safeNumberIsInteger$6 = Number.isInteger;
var safeObjectIs$6 = Object.is;
var IntegerArbitrary = class IntegerArbitrary2 extends Arbitrary {
  constructor(min4, max4) {
    super();
    this.min = min4;
    this.max = max4;
  }
  generate(mrng, biasFactor) {
    const range = this.computeGenerateRange(mrng, biasFactor);
    return new Value(mrng.nextInt(range.min, range.max), undefined);
  }
  canShrinkWithoutContext(value3) {
    return typeof value3 === "number" && safeNumberIsInteger$6(value3) && !safeObjectIs$6(value3, -0) && this.min <= value3 && value3 <= this.max;
  }
  shrink(current, context2) {
    if (!IntegerArbitrary2.isValidContext(current, context2))
      return shrinkInteger(current, this.defaultTarget(), true);
    if (this.isLastChanceTry(current, context2))
      return Stream.of(new Value(context2, undefined));
    return shrinkInteger(current, context2, false);
  }
  defaultTarget() {
    if (this.min <= 0 && this.max >= 0)
      return 0;
    return this.min < 0 ? this.max : this.min;
  }
  computeGenerateRange(mrng, biasFactor) {
    if (biasFactor === undefined || mrng.nextInt(1, biasFactor) !== 1)
      return {
        min: this.min,
        max: this.max
      };
    const ranges = biasNumericRange(this.min, this.max, integerLogLike);
    if (ranges.length === 1)
      return ranges[0];
    const id2 = mrng.nextInt(-2 * (ranges.length - 1), ranges.length - 2);
    return id2 < 0 ? ranges[0] : ranges[id2 + 1];
  }
  isLastChanceTry(current, context2) {
    if (current > 0)
      return current === context2 + 1 && current > this.min;
    if (current < 0)
      return current === context2 - 1 && current < this.max;
    return false;
  }
  static isValidContext(current, context2) {
    if (context2 === undefined)
      return false;
    if (typeof context2 !== "number")
      throw new Error(`Invalid context type passed to IntegerArbitrary (#1)`);
    if (context2 !== 0 && safeMathSign(current) !== safeMathSign(context2))
      throw new Error(`Invalid context value passed to IntegerArbitrary (#2)`);
    return true;
  }
};
var safeNumberIsInteger$5 = Number.isInteger;
function buildCompleteIntegerConstraints(constraints) {
  return {
    min: constraints.min !== undefined ? constraints.min : -2147483648,
    max: constraints.max !== undefined ? constraints.max : 2147483647
  };
}
function integer(constraints = {}) {
  const fullConstraints = buildCompleteIntegerConstraints(constraints);
  if (fullConstraints.min > fullConstraints.max)
    throw new Error("fc.integer maximum value should be equal or greater than the minimum one");
  if (!safeNumberIsInteger$5(fullConstraints.min))
    throw new Error("fc.integer minimum value should be an integer");
  if (!safeNumberIsInteger$5(fullConstraints.max))
    throw new Error("fc.integer maximum value should be an integer");
  return new IntegerArbitrary(fullConstraints.min, fullConstraints.max);
}
var depthContextCache = /* @__PURE__ */ new Map;
function getDepthContextFor(contextMeta) {
  if (contextMeta === undefined)
    return { depth: 0 };
  if (typeof contextMeta !== "string")
    return contextMeta;
  const cachedContext = safeMapGet(depthContextCache, contextMeta);
  if (cachedContext !== undefined)
    return cachedContext;
  const context2 = { depth: 0 };
  safeMapSet(depthContextCache, contextMeta, context2);
  return context2;
}
function createDepthIdentifier() {
  return { depth: 0 };
}
var NoopSlicedGenerator = class {
  constructor(arb, mrng, biasFactor) {
    this.arb = arb;
    this.mrng = mrng;
    this.biasFactor = biasFactor;
  }
  attemptExact() {}
  next() {
    return this.arb.generate(this.mrng, this.biasFactor);
  }
};
var safeMathMin$5 = Math.min;
var safeMathMax$3 = Math.max;
var SlicedBasedGenerator = class {
  constructor(arb, mrng, slices, biasFactor) {
    this.arb = arb;
    this.mrng = mrng;
    this.slices = slices;
    this.biasFactor = biasFactor;
    this.activeSliceIndex = 0;
    this.nextIndexInSlice = 0;
    this.lastIndexInSlice = -1;
  }
  attemptExact(targetLength) {
    if (targetLength !== 0 && this.mrng.nextInt(1, this.biasFactor) === 1) {
      const eligibleIndices = [];
      for (let index2 = 0;index2 !== this.slices.length; ++index2)
        if (this.slices[index2].length === targetLength)
          safePush(eligibleIndices, index2);
      if (eligibleIndices.length === 0)
        return;
      this.activeSliceIndex = eligibleIndices[this.mrng.nextInt(0, eligibleIndices.length - 1)];
      this.nextIndexInSlice = 0;
      this.lastIndexInSlice = targetLength - 1;
    }
  }
  next() {
    if (this.nextIndexInSlice <= this.lastIndexInSlice)
      return new Value(this.slices[this.activeSliceIndex][this.nextIndexInSlice++], undefined);
    if (this.mrng.nextInt(1, this.biasFactor) !== 1)
      return this.arb.generate(this.mrng, this.biasFactor);
    this.activeSliceIndex = this.mrng.nextInt(0, this.slices.length - 1);
    const slice = this.slices[this.activeSliceIndex];
    if (this.mrng.nextInt(1, this.biasFactor) !== 1) {
      this.nextIndexInSlice = 1;
      this.lastIndexInSlice = slice.length - 1;
      return new Value(slice[0], undefined);
    }
    const rangeBoundaryA = this.mrng.nextInt(0, slice.length - 1);
    const rangeBoundaryB = this.mrng.nextInt(0, slice.length - 1);
    this.nextIndexInSlice = safeMathMin$5(rangeBoundaryA, rangeBoundaryB);
    this.lastIndexInSlice = safeMathMax$3(rangeBoundaryA, rangeBoundaryB);
    return new Value(slice[this.nextIndexInSlice++], undefined);
  }
};
function buildSlicedGenerator(arb, mrng, slices, biasFactor) {
  if (biasFactor === undefined || slices.length === 0 || mrng.nextInt(1, biasFactor) !== 1)
    return new NoopSlicedGenerator(arb, mrng, biasFactor);
  return new SlicedBasedGenerator(arb, mrng, slices, biasFactor);
}
var safeMathFloor$4 = Math.floor;
var safeMathLog$1 = Math.log;
var safeMathMax$2 = Math.max;
var safeArrayIsArray$2 = Array.isArray;
function biasedMaxLength(minLength, maxLength) {
  if (minLength === maxLength)
    return minLength;
  return minLength + safeMathFloor$4(safeMathLog$1(maxLength - minLength) / safeMathLog$1(2));
}
var ArrayArbitrary = class ArrayArbitrary2 extends Arbitrary {
  constructor(arb, minLength, maxGeneratedLength, maxLength, depthIdentifier, setBuilder, customSlices) {
    super();
    this.arb = arb;
    this.minLength = minLength;
    this.maxGeneratedLength = maxGeneratedLength;
    this.maxLength = maxLength;
    this.setBuilder = setBuilder;
    this.customSlices = customSlices;
    this.lengthArb = integer({
      min: minLength,
      max: maxGeneratedLength
    });
    this.depthContext = getDepthContextFor(depthIdentifier);
  }
  preFilter(tab) {
    if (this.setBuilder === undefined)
      return tab;
    const s = this.setBuilder();
    for (let index2 = 0;index2 !== tab.length; ++index2)
      s.tryAdd(tab[index2]);
    return s.getData();
  }
  static makeItCloneable(vs, shrinkables) {
    vs[cloneMethod] = () => {
      const cloned = [];
      for (let idx = 0;idx !== shrinkables.length; ++idx)
        safePush(cloned, shrinkables[idx].value);
      this.makeItCloneable(cloned, shrinkables);
      return cloned;
    };
    return vs;
  }
  generateNItemsNoDuplicates(setBuilder, N2, mrng, biasFactorItems) {
    let numSkippedInRow = 0;
    const s = setBuilder();
    const slicedGenerator = buildSlicedGenerator(this.arb, mrng, this.customSlices, biasFactorItems);
    while (s.size() < N2 && numSkippedInRow < this.maxGeneratedLength) {
      const current = slicedGenerator.next();
      if (s.tryAdd(current))
        numSkippedInRow = 0;
      else
        numSkippedInRow += 1;
    }
    return s.getData();
  }
  safeGenerateNItemsNoDuplicates(setBuilder, N2, mrng, biasFactorItems) {
    const depthImpact = safeMathMax$2(0, N2 - biasedMaxLength(this.minLength, this.maxGeneratedLength));
    this.depthContext.depth += depthImpact;
    try {
      return this.generateNItemsNoDuplicates(setBuilder, N2, mrng, biasFactorItems);
    } finally {
      this.depthContext.depth -= depthImpact;
    }
  }
  generateNItems(N2, mrng, biasFactorItems) {
    const items = [];
    const slicedGenerator = buildSlicedGenerator(this.arb, mrng, this.customSlices, biasFactorItems);
    slicedGenerator.attemptExact(N2);
    for (let index2 = 0;index2 !== N2; ++index2)
      safePush(items, slicedGenerator.next());
    return items;
  }
  safeGenerateNItems(N2, mrng, biasFactorItems) {
    const depthImpact = safeMathMax$2(0, N2 - biasedMaxLength(this.minLength, this.maxGeneratedLength));
    this.depthContext.depth += depthImpact;
    try {
      return this.generateNItems(N2, mrng, biasFactorItems);
    } finally {
      this.depthContext.depth -= depthImpact;
    }
  }
  wrapper(itemsRaw, shrunkOnce, itemsRawLengthContext, startIndex) {
    const items = shrunkOnce ? this.preFilter(itemsRaw) : itemsRaw;
    let cloneable = false;
    const vs = [];
    const itemsContexts = [];
    for (let idx = 0;idx !== items.length; ++idx) {
      const s = items[idx];
      cloneable = cloneable || s.hasToBeCloned;
      safePush(vs, s.value);
      safePush(itemsContexts, s.context);
    }
    if (cloneable)
      ArrayArbitrary2.makeItCloneable(vs, items);
    return new Value(vs, {
      shrunkOnce,
      lengthContext: itemsRaw.length === items.length && itemsRawLengthContext !== undefined ? itemsRawLengthContext : undefined,
      itemsContexts,
      startIndex
    });
  }
  generate(mrng, biasFactor) {
    const biasMeta = this.applyBias(mrng, biasFactor);
    const targetSize = biasMeta.size;
    const items = this.setBuilder !== undefined ? this.safeGenerateNItemsNoDuplicates(this.setBuilder, targetSize, mrng, biasMeta.biasFactorItems) : this.safeGenerateNItems(targetSize, mrng, biasMeta.biasFactorItems);
    return this.wrapper(items, false, undefined, 0);
  }
  applyBias(mrng, biasFactor) {
    if (biasFactor === undefined)
      return { size: this.lengthArb.generate(mrng, undefined).value };
    if (this.minLength === this.maxGeneratedLength)
      return {
        size: this.lengthArb.generate(mrng, undefined).value,
        biasFactorItems: biasFactor
      };
    if (mrng.nextInt(1, biasFactor) !== 1)
      return { size: this.lengthArb.generate(mrng, undefined).value };
    if (mrng.nextInt(1, biasFactor) !== 1 || this.minLength === this.maxGeneratedLength)
      return {
        size: this.lengthArb.generate(mrng, undefined).value,
        biasFactorItems: biasFactor
      };
    const maxBiasedLength = biasedMaxLength(this.minLength, this.maxGeneratedLength);
    return {
      size: integer({
        min: this.minLength,
        max: maxBiasedLength
      }).generate(mrng, undefined).value,
      biasFactorItems: biasFactor
    };
  }
  canShrinkWithoutContext(value3) {
    if (!safeArrayIsArray$2(value3) || this.minLength > value3.length || value3.length > this.maxLength)
      return false;
    for (let index2 = 0;index2 !== value3.length; ++index2) {
      if (!(index2 in value3))
        return false;
      if (!this.arb.canShrinkWithoutContext(value3[index2]))
        return false;
    }
    return this.preFilter(safeMap(value3, (item) => new Value(item, undefined))).length === value3.length;
  }
  shrinkItemByItem(value3, safeContext, endIndex) {
    const shrinks = [];
    for (let index2 = safeContext.startIndex;index2 < endIndex; ++index2)
      safePush(shrinks, makeLazy2(() => this.arb.shrink(value3[index2], safeContext.itemsContexts[index2]).map((v) => {
        const beforeCurrent = safeMap(safeSlice(value3, 0, index2), (v2, i) => new Value(cloneIfNeeded(v2), safeContext.itemsContexts[i]));
        const afterCurrent = safeMap(safeSlice(value3, index2 + 1), (v2, i) => new Value(cloneIfNeeded(v2), safeContext.itemsContexts[i + index2 + 1]));
        return [
          [
            ...beforeCurrent,
            v,
            ...afterCurrent
          ],
          undefined,
          index2
        ];
      })));
    return Stream.nil().join(...shrinks);
  }
  shrinkImpl(value3, context2) {
    if (value3.length === 0)
      return Stream.nil();
    const safeContext = context2 !== undefined ? context2 : {
      shrunkOnce: false,
      lengthContext: undefined,
      itemsContexts: [],
      startIndex: 0
    };
    return this.lengthArb.shrink(value3.length, safeContext.lengthContext).drop(safeContext.shrunkOnce && safeContext.lengthContext === undefined && value3.length > this.minLength + 1 ? 1 : 0).map((lengthValue) => {
      const sliceStart = value3.length - lengthValue.value;
      return [
        safeMap(safeSlice(value3, sliceStart), (v, index2) => new Value(cloneIfNeeded(v), safeContext.itemsContexts[index2 + sliceStart])),
        lengthValue.context,
        0
      ];
    }).join(makeLazy2(() => value3.length > this.minLength ? this.shrinkItemByItem(value3, safeContext, 1) : this.shrinkItemByItem(value3, safeContext, value3.length))).join(value3.length > this.minLength ? makeLazy2(() => {
      const subContext = {
        shrunkOnce: false,
        lengthContext: undefined,
        itemsContexts: safeSlice(safeContext.itemsContexts, 1),
        startIndex: 0
      };
      return this.shrinkImpl(safeSlice(value3, 1), subContext).filter((v) => this.minLength <= v[0].length + 1).map((v) => {
        return [
          [new Value(cloneIfNeeded(value3[0]), safeContext.itemsContexts[0]), ...v[0]],
          undefined,
          0
        ];
      });
    }) : Stream.nil());
  }
  shrink(value3, context2) {
    return this.shrinkImpl(value3, context2).map((contextualValue) => this.wrapper(contextualValue[0], true, contextualValue[1], contextualValue[2]));
  }
};
var safeMathFloor$3 = Math.floor;
var safeMathMin$4 = Math.min;
var MaxLengthUpperBound = 2147483647;
var orderedSize = [
  "xsmall",
  "small",
  "medium",
  "large",
  "xlarge"
];
var orderedRelativeSize = [
  "-4",
  "-3",
  "-2",
  "-1",
  "=",
  "+1",
  "+2",
  "+3",
  "+4"
];
var DefaultSize = "small";
function maxLengthFromMinLength(minLength, size6) {
  switch (size6) {
    case "xsmall":
      return safeMathFloor$3(1.1 * minLength) + 1;
    case "small":
      return 2 * minLength + 10;
    case "medium":
      return 11 * minLength + 100;
    case "large":
      return 101 * minLength + 1000;
    case "xlarge":
      return 1001 * minLength + 1e4;
    default:
      throw new Error(`Unable to compute lengths based on received size: ${size6}`);
  }
}
function relativeSizeToSize(size6, defaultSize) {
  const sizeInRelative = safeIndexOf(orderedRelativeSize, size6);
  if (sizeInRelative === -1)
    return size6;
  const defaultSizeInSize = safeIndexOf(orderedSize, defaultSize);
  if (defaultSizeInSize === -1)
    throw new Error(`Unable to offset size based on the unknown defaulted one: ${defaultSize}`);
  const resultingSizeInSize = defaultSizeInSize + sizeInRelative - 4;
  return resultingSizeInSize < 0 ? orderedSize[0] : resultingSizeInSize >= orderedSize.length ? orderedSize[orderedSize.length - 1] : orderedSize[resultingSizeInSize];
}
function maxGeneratedLengthFromSizeForArbitrary(size6, minLength, maxLength, specifiedMaxLength) {
  const { baseSize: defaultSize = DefaultSize, defaultSizeToMaxWhenMaxSpecified } = readConfigureGlobal() || {};
  const definedSize = size6 !== undefined ? size6 : specifiedMaxLength && defaultSizeToMaxWhenMaxSpecified ? "max" : defaultSize;
  if (definedSize === "max")
    return maxLength;
  return safeMathMin$4(maxLengthFromMinLength(minLength, relativeSizeToSize(definedSize, defaultSize)), maxLength);
}
function depthBiasFromSizeForArbitrary(depthSizeOrSize, specifiedMaxDepth) {
  if (typeof depthSizeOrSize === "number")
    return 1 / depthSizeOrSize;
  const { baseSize: defaultSize = DefaultSize, defaultSizeToMaxWhenMaxSpecified } = readConfigureGlobal() || {};
  const definedSize = depthSizeOrSize !== undefined ? depthSizeOrSize : specifiedMaxDepth && defaultSizeToMaxWhenMaxSpecified ? "max" : defaultSize;
  if (definedSize === "max")
    return 0;
  switch (relativeSizeToSize(definedSize, defaultSize)) {
    case "xsmall":
      return 1;
    case "small":
      return 0.5;
    case "medium":
      return 0.25;
    case "large":
      return 0.125;
    case "xlarge":
      return 0.0625;
  }
}
function resolveSize(size6) {
  const { baseSize: defaultSize = DefaultSize } = readConfigureGlobal() || {};
  if (size6 === undefined)
    return defaultSize;
  return relativeSizeToSize(size6, defaultSize);
}
function array3(arb, constraints = {}) {
  const size6 = constraints.size;
  const minLength = constraints.minLength || 0;
  const maxLengthOrUnset = constraints.maxLength;
  const depthIdentifier = constraints.depthIdentifier;
  const maxLength = maxLengthOrUnset !== undefined ? maxLengthOrUnset : MaxLengthUpperBound;
  return new ArrayArbitrary(arb, minLength, maxGeneratedLengthFromSizeForArbitrary(size6, minLength, maxLength, maxLengthOrUnset !== undefined), maxLength, depthIdentifier, undefined, constraints.experimentalCustomSlices || []);
}
function halveBigInt(n) {
  return n / SBigInt2(2);
}
function shrinkBigInt(current, target, tryTargetAsap) {
  const realGap = current - target;
  function* shrinkDecr() {
    let previous = tryTargetAsap ? undefined : target;
    const gap = tryTargetAsap ? realGap : halveBigInt(realGap);
    for (let toremove = gap;toremove > 0; toremove = halveBigInt(toremove)) {
      const next = current - toremove;
      yield new Value(next, previous);
      previous = next;
    }
  }
  function* shrinkIncr() {
    let previous = tryTargetAsap ? undefined : target;
    const gap = tryTargetAsap ? realGap : halveBigInt(realGap);
    for (let toremove = gap;toremove < 0; toremove = halveBigInt(toremove)) {
      const next = current - toremove;
      yield new Value(next, previous);
      previous = next;
    }
  }
  return realGap > 0 ? stream(shrinkDecr()) : stream(shrinkIncr());
}
var BigIntArbitrary = class BigIntArbitrary2 extends Arbitrary {
  constructor(min4, max4) {
    super();
    this.min = min4;
    this.max = max4;
  }
  generate(mrng, biasFactor) {
    const range = this.computeGenerateRange(mrng, biasFactor);
    return new Value(mrng.nextBigInt(range.min, range.max), undefined);
  }
  computeGenerateRange(mrng, biasFactor) {
    if (biasFactor === undefined || mrng.nextInt(1, biasFactor) !== 1)
      return {
        min: this.min,
        max: this.max
      };
    const ranges = biasNumericRange(this.min, this.max, bigIntLogLike);
    if (ranges.length === 1)
      return ranges[0];
    const id2 = mrng.nextInt(-2 * (ranges.length - 1), ranges.length - 2);
    return id2 < 0 ? ranges[0] : ranges[id2 + 1];
  }
  canShrinkWithoutContext(value3) {
    return typeof value3 === "bigint" && this.min <= value3 && value3 <= this.max;
  }
  shrink(current, context2) {
    if (!BigIntArbitrary2.isValidContext(current, context2))
      return shrinkBigInt(current, this.defaultTarget(), true);
    if (this.isLastChanceTry(current, context2))
      return Stream.of(new Value(context2, undefined));
    return shrinkBigInt(current, context2, false);
  }
  defaultTarget() {
    if (this.min <= 0 && this.max >= 0)
      return SBigInt2(0);
    return this.min < 0 ? this.max : this.min;
  }
  isLastChanceTry(current, context2) {
    if (current > 0)
      return current === context2 + SBigInt2(1) && current > this.min;
    if (current < 0)
      return current === context2 - SBigInt2(1) && current < this.max;
    return false;
  }
  static isValidContext(current, context2) {
    if (context2 === undefined)
      return false;
    if (typeof context2 !== "bigint")
      throw new Error(`Invalid context type passed to BigIntArbitrary (#1)`);
    const differentSigns = current > 0 && context2 < 0 || current < 0 && context2 > 0;
    if (context2 !== SBigInt2(0) && differentSigns)
      throw new Error(`Invalid context value passed to BigIntArbitrary (#2)`);
    return true;
  }
};
function buildCompleteBigIntConstraints(constraints) {
  const DefaultPow = 256;
  const DefaultMin = SBigInt2(-1) << SBigInt2(DefaultPow - 1);
  const DefaultMax = (SBigInt2(1) << SBigInt2(DefaultPow - 1)) - SBigInt2(1);
  const min4 = constraints.min;
  const max4 = constraints.max;
  return {
    min: min4 !== undefined ? min4 : DefaultMin - (max4 !== undefined && max4 < SBigInt2(0) ? max4 * max4 : SBigInt2(0)),
    max: max4 !== undefined ? max4 : DefaultMax + (min4 !== undefined && min4 > SBigInt2(0) ? min4 * min4 : SBigInt2(0))
  };
}
function extractBigIntConstraints(args2) {
  if (args2[0] === undefined)
    return {};
  if (args2[1] === undefined)
    return args2[0];
  return {
    min: args2[0],
    max: args2[1]
  };
}
function bigInt2(...args2) {
  const constraints = buildCompleteBigIntConstraints(extractBigIntConstraints(args2));
  if (constraints.min > constraints.max)
    throw new Error("fc.bigInt expects max to be greater than or equal to min");
  return new BigIntArbitrary(constraints.min, constraints.max);
}
var stableObjectGetPrototypeOf$1 = Object.getPrototypeOf;
var NoBiasArbitrary = class extends Arbitrary {
  constructor(arb) {
    super();
    this.arb = arb;
  }
  generate(mrng, _biasFactor) {
    return this.arb.generate(mrng, undefined);
  }
  canShrinkWithoutContext(value3) {
    return this.arb.canShrinkWithoutContext(value3);
  }
  shrink(value3, context2) {
    return this.arb.shrink(value3, context2);
  }
};
function noBias(arb) {
  if (stableObjectGetPrototypeOf$1(arb) === NoBiasArbitrary.prototype && arb.generate === NoBiasArbitrary.prototype.generate && arb.canShrinkWithoutContext === NoBiasArbitrary.prototype.canShrinkWithoutContext && arb.shrink === NoBiasArbitrary.prototype.shrink)
    return arb;
  return new NoBiasArbitrary(arb);
}
function booleanMapper(v) {
  return v === 1;
}
function booleanUnmapper(v) {
  if (typeof v !== "boolean")
    throw new Error("Unsupported input type");
  return v === true ? 1 : 0;
}
function boolean2() {
  return noBias(integer({
    min: 0,
    max: 1
  }).map(booleanMapper, booleanUnmapper));
}
var safeObjectIs$5 = Object.is;
var FastConstantValuesLookup = class {
  constructor(values2) {
    this.values = values2;
    this.fastValues = new SSet(this.values);
    let hasMinusZero = false;
    let hasPlusZero = false;
    if (safeHas(this.fastValues, 0))
      for (let idx = 0;idx !== this.values.length; ++idx) {
        const value3 = this.values[idx];
        hasMinusZero = hasMinusZero || safeObjectIs$5(value3, -0);
        hasPlusZero = hasPlusZero || safeObjectIs$5(value3, 0);
      }
    this.hasMinusZero = hasMinusZero;
    this.hasPlusZero = hasPlusZero;
  }
  has(value3) {
    if (value3 === 0) {
      if (safeObjectIs$5(value3, 0))
        return this.hasPlusZero;
      return this.hasMinusZero;
    }
    return safeHas(this.fastValues, value3);
  }
};
var ConstantArbitrary = class extends Arbitrary {
  constructor(values2) {
    super();
    this.values = values2;
  }
  generate(mrng, _biasFactor) {
    const idx = this.values.length === 1 ? 0 : mrng.nextInt(0, this.values.length - 1);
    const value3 = this.values[idx];
    if (!hasCloneMethod(value3))
      return new Value(value3, idx);
    return new Value(value3, idx, () => value3[cloneMethod]());
  }
  canShrinkWithoutContext(value3) {
    if (this.values.length === 1)
      return safeObjectIs$5(this.values[0], value3);
    if (this.fastValues === undefined)
      this.fastValues = new FastConstantValuesLookup(this.values);
    return this.fastValues.has(value3);
  }
  shrink(value3, context2) {
    if (context2 === 0 || safeObjectIs$5(value3, this.values[0]))
      return Stream.nil();
    return Stream.of(new Value(this.values[0], 0));
  }
};
function constantFrom(...values2) {
  if (values2.length === 0)
    throw new Error("fc.constantFrom expects at least one parameter");
  return new ConstantArbitrary(values2);
}
function falsy(constraints) {
  if (!constraints || !constraints.withBigInt)
    return constantFrom(false, null, undefined, 0, "", NaN);
  return constantFrom(false, null, undefined, 0, "", NaN, SBigInt2(0));
}
function constant2(value3) {
  return new ConstantArbitrary([value3]);
}
var ContextImplem = class ContextImplem2 {
  constructor() {
    this.receivedLogs = [];
  }
  log(data) {
    this.receivedLogs.push(data);
  }
  size() {
    return this.receivedLogs.length;
  }
  toString() {
    return JSON.stringify({ logs: this.receivedLogs });
  }
  [cloneMethod]() {
    return new ContextImplem2;
  }
};
function context2() {
  return constant2(new ContextImplem);
}
var safeNaN$2 = NaN;
var safeNumberIsNaN$4 = Number.isNaN;
function timeToDateMapper(time) {
  return new SDate(time);
}
function timeToDateUnmapper(value3) {
  if (!(value3 instanceof SDate) || value3.constructor !== SDate)
    throw new SError("Not a valid value for date unmapper");
  return safeGetTime(value3);
}
function timeToDateMapperWithNaN(valueForNaN) {
  return (time) => {
    return time === valueForNaN ? new SDate(safeNaN$2) : timeToDateMapper(time);
  };
}
function timeToDateUnmapperWithNaN(valueForNaN) {
  return (value3) => {
    const time = timeToDateUnmapper(value3);
    return safeNumberIsNaN$4(time) ? valueForNaN : time;
  };
}
var safeNumberIsNaN$3 = Number.isNaN;
function date(constraints = {}) {
  const intMin = constraints.min !== undefined ? safeGetTime(constraints.min) : -8640000000000000;
  const intMax = constraints.max !== undefined ? safeGetTime(constraints.max) : 8640000000000000;
  const noInvalidDate = constraints.noInvalidDate;
  if (safeNumberIsNaN$3(intMin))
    throw new Error("fc.date min must be valid instance of Date");
  if (safeNumberIsNaN$3(intMax))
    throw new Error("fc.date max must be valid instance of Date");
  if (intMin > intMax)
    throw new Error("fc.date max must be greater or equal to min");
  if (noInvalidDate)
    return integer({
      min: intMin,
      max: intMax
    }).map(timeToDateMapper, timeToDateUnmapper);
  const valueForNaN = intMax + 1;
  return integer({
    min: intMin,
    max: intMax + 1
  }).map(timeToDateMapperWithNaN(valueForNaN), timeToDateUnmapperWithNaN(valueForNaN));
}
var ChainUntilArbitrary = class extends Arbitrary {
  constructor(startArb, chainer) {
    super();
    this.startArb = startArb;
    this.chainer = chainer;
  }
  generate(mrng, biasFactor) {
    const entries3 = [];
    const clonedMrng = mrng.clone();
    let current = this.startArb.generate(mrng, biasFactor);
    entries3.push({
      arbitrary: this.startArb,
      value: current.value_,
      context: current.context,
      clonedMrng
    });
    while (true) {
      const nextArb = this.chainer(current.value_);
      if (nextArb === undefined)
        break;
      const nextClonedMrng = mrng.clone();
      current = nextArb.generate(mrng, biasFactor);
      entries3.push({
        arbitrary: nextArb,
        value: current.value_,
        context: current.context,
        clonedMrng: nextClonedMrng
      });
    }
    const ctx = {
      biasFactor,
      entries: entries3,
      currentShrinkLevel: 0
    };
    return new Value(current.value_, ctx);
  }
  canShrinkWithoutContext(_value) {
    return false;
  }
  shrink(value3, context3) {
    if (!this.isSafeContext(context3))
      return Stream.nil();
    return new Stream(this.shrinkIterator(context3));
  }
  *shrinkIterator(context3) {
    const { entries: entries3, currentShrinkLevel, biasFactor } = context3;
    for (let level = currentShrinkLevel;level < entries3.length; ++level) {
      const entry = entries3[level];
      const shrinks = entry.arbitrary.shrink(entry.value, entry.context);
      for (const shrunkValue of shrinks) {
        const newEntries = entries3.slice(0, level);
        newEntries.push({
          arbitrary: entry.arbitrary,
          value: shrunkValue.value_,
          context: shrunkValue.context,
          clonedMrng: entry.clonedMrng
        });
        let current = shrunkValue;
        const mrng = entry.clonedMrng.clone();
        while (true) {
          const nextArb = this.chainer(current.value_);
          if (nextArb === undefined)
            break;
          const nextClonedMrng = mrng.clone();
          const next = nextArb.generate(mrng, biasFactor);
          newEntries.push({
            arbitrary: nextArb,
            value: next.value_,
            context: next.context,
            clonedMrng: nextClonedMrng
          });
          current = next;
        }
        const lastEntry = newEntries[newEntries.length - 1];
        const newContext = {
          biasFactor,
          entries: newEntries,
          currentShrinkLevel: level
        };
        yield new Value(lastEntry.value, newContext);
      }
    }
  }
  isSafeContext(context3) {
    return context3 !== null && context3 !== undefined && typeof context3 === "object" && "biasFactor" in context3 && "entries" in context3 && "currentShrinkLevel" in context3;
  }
};
function chainUntil(startArb, chainer) {
  return new ChainUntilArbitrary(startArb, chainer);
}
var safeSymbolIterator = Symbol.iterator;
var safeIsArray = Array.isArray;
var safeObjectIs$4 = Object.is;
var CloneArbitrary = class CloneArbitrary2 extends Arbitrary {
  constructor(arb, numValues) {
    super();
    this.arb = arb;
    this.numValues = numValues;
  }
  generate(mrng, biasFactor) {
    const items = [];
    if (this.numValues <= 0)
      return this.wrapper(items);
    for (let idx = 0;idx !== this.numValues - 1; ++idx)
      safePush(items, this.arb.generate(mrng.clone(), biasFactor));
    safePush(items, this.arb.generate(mrng, biasFactor));
    return this.wrapper(items);
  }
  canShrinkWithoutContext(value3) {
    if (!safeIsArray(value3) || value3.length !== this.numValues)
      return false;
    if (value3.length === 0)
      return true;
    for (let index2 = 1;index2 < value3.length; ++index2)
      if (!safeObjectIs$4(value3[0], value3[index2]))
        return false;
    return this.arb.canShrinkWithoutContext(value3[0]);
  }
  shrink(value3, context3) {
    if (value3.length === 0)
      return Stream.nil();
    return new Stream(this.shrinkImpl(value3, context3 !== undefined ? context3 : [])).map((v) => this.wrapper(v));
  }
  *shrinkImpl(value3, contexts) {
    const its = safeMap(value3, (v, idx) => this.arb.shrink(v, contexts[idx])[safeSymbolIterator]());
    let cur = safeMap(its, (it) => it.next());
    while (!cur[0].done) {
      yield safeMap(cur, (c) => c.value);
      cur = safeMap(its, (it) => it.next());
    }
  }
  static makeItCloneable(vs, shrinkables) {
    vs[cloneMethod] = () => {
      const cloned = [];
      for (let idx = 0;idx !== shrinkables.length; ++idx)
        safePush(cloned, shrinkables[idx].value);
      this.makeItCloneable(cloned, shrinkables);
      return cloned;
    };
    return vs;
  }
  wrapper(items) {
    let cloneable = false;
    const vs = [];
    const contexts = [];
    for (let idx = 0;idx !== items.length; ++idx) {
      const s = items[idx];
      cloneable = cloneable || s.hasToBeCloned;
      safePush(vs, s.value);
      safePush(contexts, s.context);
    }
    if (cloneable)
      CloneArbitrary2.makeItCloneable(vs, items);
    return new Value(vs, contexts);
  }
};
function clone(arb, numValues) {
  return new CloneArbitrary(arb, numValues);
}
var CustomEqualSet = class {
  constructor(isEqual2) {
    this.isEqual = isEqual2;
    this.data = [];
  }
  tryAdd(value3) {
    for (let idx = 0;idx !== this.data.length; ++idx)
      if (this.isEqual(this.data[idx], value3))
        return false;
    safePush(this.data, value3);
    return true;
  }
  size() {
    return this.data.length;
  }
  getData() {
    return this.data;
  }
};
var safeNumberIsNaN$2 = Number.isNaN;
var StrictlyEqualSet = class {
  constructor(selector) {
    this.selector = selector;
    this.selectedItemsExceptNaN = new SSet;
    this.data = [];
  }
  tryAdd(value3) {
    const selected = this.selector(value3);
    if (safeNumberIsNaN$2(selected)) {
      safePush(this.data, value3);
      return true;
    }
    const sizeBefore = this.selectedItemsExceptNaN.size;
    safeAdd(this.selectedItemsExceptNaN, selected);
    if (sizeBefore !== this.selectedItemsExceptNaN.size) {
      safePush(this.data, value3);
      return true;
    }
    return false;
  }
  size() {
    return this.data.length;
  }
  getData() {
    return this.data;
  }
};
var safeObjectIs$3 = Object.is;
var SameValueSet = class {
  constructor(selector) {
    this.selector = selector;
    this.selectedItemsExceptMinusZero = new SSet;
    this.data = [];
    this.hasMinusZero = false;
  }
  tryAdd(value3) {
    const selected = this.selector(value3);
    if (safeObjectIs$3(selected, -0)) {
      if (this.hasMinusZero)
        return false;
      safePush(this.data, value3);
      this.hasMinusZero = true;
      return true;
    }
    const sizeBefore = this.selectedItemsExceptMinusZero.size;
    safeAdd(this.selectedItemsExceptMinusZero, selected);
    if (sizeBefore !== this.selectedItemsExceptMinusZero.size) {
      safePush(this.data, value3);
      return true;
    }
    return false;
  }
  size() {
    return this.data.length;
  }
  getData() {
    return this.data;
  }
};
var SameValueZeroSet = class {
  constructor(selector) {
    this.selector = selector;
    this.selectedItems = new SSet;
    this.data = [];
  }
  tryAdd(value3) {
    const selected = this.selector(value3);
    const sizeBefore = this.selectedItems.size;
    safeAdd(this.selectedItems, selected);
    if (sizeBefore !== this.selectedItems.size) {
      safePush(this.data, value3);
      return true;
    }
    return false;
  }
  size() {
    return this.data.length;
  }
  getData() {
    return this.data;
  }
};
function buildUniqueArraySetBuilder(constraints) {
  if (typeof constraints.comparator === "function") {
    if (constraints.selector === undefined) {
      const comparator2 = constraints.comparator;
      const isEqualForBuilder2 = (nextA, nextB) => comparator2(nextA.value_, nextB.value_);
      return () => new CustomEqualSet(isEqualForBuilder2);
    }
    const comparator = constraints.comparator;
    const selector2 = constraints.selector;
    const refinedSelector2 = (next) => selector2(next.value_);
    const isEqualForBuilder = (nextA, nextB) => comparator(refinedSelector2(nextA), refinedSelector2(nextB));
    return () => new CustomEqualSet(isEqualForBuilder);
  }
  const selector = constraints.selector || ((v) => v);
  const refinedSelector = (next) => selector(next.value_);
  switch (constraints.comparator) {
    case "IsStrictlyEqual":
      return () => new StrictlyEqualSet(refinedSelector);
    case "SameValueZero":
      return () => new SameValueZeroSet(refinedSelector);
    case "SameValue":
    case undefined:
      return () => new SameValueSet(refinedSelector);
  }
}
function uniqueArray(arb, constraints = {}) {
  const minLength = constraints.minLength !== undefined ? constraints.minLength : 0;
  const maxLength = constraints.maxLength !== undefined ? constraints.maxLength : MaxLengthUpperBound;
  const maxGeneratedLength = maxGeneratedLengthFromSizeForArbitrary(constraints.size, minLength, maxLength, constraints.maxLength !== undefined);
  const depthIdentifier = constraints.depthIdentifier;
  const arrayArb = new ArrayArbitrary(arb, minLength, maxGeneratedLength, maxLength, depthIdentifier, buildUniqueArraySetBuilder(constraints), []);
  if (minLength === 0)
    return arrayArb;
  return arrayArb.filter((tab) => tab.length >= minLength);
}
var safeObjectCreate$5 = Object.create;
var safeObjectDefineProperty$2 = Object.defineProperty;
var safeObjectGetOwnPropertyDescriptor$2 = Object.getOwnPropertyDescriptor;
var safeObjectGetPrototypeOf$1 = Object.getPrototypeOf;
var safeObjectPrototype$1 = Object.prototype;
var safeReflectOwnKeys = Reflect.ownKeys;
function keyValuePairsToObjectMapper(definition) {
  const obj = definition[1] ? safeObjectCreate$5(null) : {};
  for (const keyValue of definition[0])
    safeObjectDefineProperty$2(obj, keyValue[0], {
      enumerable: true,
      configurable: true,
      writable: true,
      value: keyValue[1]
    });
  return obj;
}
function isValidPropertyNameFilter(descriptor) {
  return descriptor !== undefined && !!descriptor.configurable && !!descriptor.enumerable && !!descriptor.writable && descriptor.get === undefined && descriptor.set === undefined;
}
function keyValuePairsToObjectUnmapper(value3) {
  if (typeof value3 !== "object" || value3 === null)
    throw new SError("Incompatible instance received: should be a non-null object");
  const hasNullPrototype = safeObjectGetPrototypeOf$1(value3) === null;
  const hasObjectPrototype = safeObjectGetPrototypeOf$1(value3) === safeObjectPrototype$1;
  if (!hasNullPrototype && !hasObjectPrototype)
    throw new SError("Incompatible instance received: should be of exact type Object");
  const propertyDescriptors = safeMap(safeReflectOwnKeys(value3), (key) => [key, safeObjectGetOwnPropertyDescriptor$2(value3, key)]);
  if (!safeEvery(propertyDescriptors, ([, descriptor]) => isValidPropertyNameFilter(descriptor)))
    throw new SError("Incompatible instance received: should contain only c/e/w properties without get/set");
  return [safeMap(propertyDescriptors, ([key, descriptor]) => [key, descriptor.value]), hasNullPrototype];
}
function dictionaryKeyExtractor(entry) {
  return entry[0];
}
function dictionary(keyArb, valueArb, constraints = {}) {
  const noNullPrototype = !!constraints.noNullPrototype;
  return tuple2(uniqueArray(tuple2(keyArb, valueArb), {
    minLength: constraints.minKeys,
    maxLength: constraints.maxKeys,
    size: constraints.size,
    selector: dictionaryKeyExtractor,
    depthIdentifier: constraints.depthIdentifier
  }), noNullPrototype ? constant2(false) : boolean2()).map(keyValuePairsToObjectMapper, keyValuePairsToObjectUnmapper);
}
var safePositiveInfinity$7 = Number.POSITIVE_INFINITY;
var safeMaxSafeInteger$2 = Number.MAX_SAFE_INTEGER;
var safeNumberIsInteger$4 = Number.isInteger;
var safeMathFloor$2 = Math.floor;
var safeMathPow = Math.pow;
var safeMathMin$3 = Math.min;
var FrequencyArbitrary = class FrequencyArbitrary2 extends Arbitrary {
  static from(warbs, constraints, label) {
    if (warbs.length === 0)
      throw new Error(`${label} expects at least one weighted arbitrary`);
    let totalWeight = 0;
    for (let idx = 0;idx !== warbs.length; ++idx) {
      if (warbs[idx].arbitrary === undefined)
        throw new Error(`${label} expects arbitraries to be specified`);
      const currentWeight = warbs[idx].weight;
      totalWeight += currentWeight;
      if (!safeNumberIsInteger$4(currentWeight))
        throw new Error(`${label} expects weights to be integer values`);
      if (currentWeight < 0)
        throw new Error(`${label} expects weights to be superior or equal to 0`);
    }
    if (totalWeight <= 0)
      throw new Error(`${label} expects the sum of weights to be strictly superior to 0`);
    return new FrequencyArbitrary2(warbs, {
      depthBias: depthBiasFromSizeForArbitrary(constraints.depthSize, constraints.maxDepth !== undefined),
      maxDepth: constraints.maxDepth !== undefined ? constraints.maxDepth : safePositiveInfinity$7,
      withCrossShrink: !!constraints.withCrossShrink
    }, getDepthContextFor(constraints.depthIdentifier));
  }
  constructor(warbs, constraints, context3) {
    super();
    this.warbs = warbs;
    this.constraints = constraints;
    this.context = context3;
    let currentWeight = 0;
    this.cumulatedWeights = [];
    for (let idx = 0;idx !== warbs.length; ++idx) {
      currentWeight += warbs[idx].weight;
      safePush(this.cumulatedWeights, currentWeight);
    }
    this.totalWeight = currentWeight;
  }
  generate(mrng, biasFactor) {
    if (this.mustGenerateFirst())
      return this.safeGenerateForIndex(mrng, 0, biasFactor);
    const selected = mrng.nextInt(this.computeNegDepthBenefit(), this.totalWeight - 1);
    for (let idx = 0;idx !== this.cumulatedWeights.length; ++idx)
      if (selected < this.cumulatedWeights[idx])
        return this.safeGenerateForIndex(mrng, idx, biasFactor);
    throw new Error(`Unable to generate from fc.frequency`);
  }
  canShrinkWithoutContext(value3) {
    return this.canShrinkWithoutContextIndex(value3) !== -1;
  }
  shrink(value3, context3) {
    if (context3 !== undefined) {
      const safeContext = context3;
      const selectedIndex = safeContext.selectedIndex;
      const originalBias = safeContext.originalBias;
      const originalShrinks = this.warbs[selectedIndex].arbitrary.shrink(value3, safeContext.originalContext).map((v) => this.mapIntoValue(selectedIndex, v, null, originalBias));
      if (safeContext.clonedMrngForFallbackFirst !== null) {
        if (safeContext.cachedGeneratedForFirst === undefined)
          safeContext.cachedGeneratedForFirst = this.safeGenerateForIndex(safeContext.clonedMrngForFallbackFirst, 0, originalBias);
        const valueFromFirst = safeContext.cachedGeneratedForFirst;
        return Stream.of(valueFromFirst).join(originalShrinks);
      }
      return originalShrinks;
    }
    const potentialSelectedIndex = this.canShrinkWithoutContextIndex(value3);
    if (potentialSelectedIndex === -1)
      return Stream.nil();
    return this.defaultShrinkForFirst(potentialSelectedIndex).join(this.warbs[potentialSelectedIndex].arbitrary.shrink(value3, undefined).map((v) => this.mapIntoValue(potentialSelectedIndex, v, null, undefined)));
  }
  defaultShrinkForFirst(selectedIndex) {
    ++this.context.depth;
    try {
      if (!this.mustFallbackToFirstInShrink(selectedIndex) || this.warbs[0].fallbackValue === undefined)
        return Stream.nil();
    } finally {
      --this.context.depth;
    }
    const rawShrinkValue = new Value(this.warbs[0].fallbackValue.default, undefined);
    return Stream.of(this.mapIntoValue(0, rawShrinkValue, null, undefined));
  }
  canShrinkWithoutContextIndex(value3) {
    if (this.mustGenerateFirst())
      return this.warbs[0].arbitrary.canShrinkWithoutContext(value3) ? 0 : -1;
    try {
      ++this.context.depth;
      for (let idx = 0;idx !== this.warbs.length; ++idx) {
        const warb = this.warbs[idx];
        if (warb.weight !== 0 && warb.arbitrary.canShrinkWithoutContext(value3))
          return idx;
      }
      return -1;
    } finally {
      --this.context.depth;
    }
  }
  mapIntoValue(idx, value3, clonedMrngForFallbackFirst, biasFactor) {
    const context3 = {
      selectedIndex: idx,
      originalBias: biasFactor,
      originalContext: value3.context,
      clonedMrngForFallbackFirst
    };
    return new Value(value3.value, context3);
  }
  safeGenerateForIndex(mrng, idx, biasFactor) {
    ++this.context.depth;
    try {
      const value3 = this.warbs[idx].arbitrary.generate(mrng, biasFactor);
      const clonedMrngForFallbackFirst = this.mustFallbackToFirstInShrink(idx) ? mrng.clone() : null;
      return this.mapIntoValue(idx, value3, clonedMrngForFallbackFirst, biasFactor);
    } finally {
      --this.context.depth;
    }
  }
  mustGenerateFirst() {
    return this.constraints.maxDepth <= this.context.depth;
  }
  mustFallbackToFirstInShrink(idx) {
    return idx !== 0 && this.constraints.withCrossShrink && this.warbs[0].weight !== 0;
  }
  computeNegDepthBenefit() {
    const depthBias = this.constraints.depthBias;
    if (depthBias <= 0 || this.warbs[0].weight === 0)
      return 0;
    const depthBenefit = safeMathFloor$2(safeMathPow(1 + depthBias, this.context.depth)) - 1;
    return -safeMathMin$3(this.totalWeight * depthBenefit, safeMaxSafeInteger$2) || 0;
  }
};
function isOneOfContraints(param) {
  return param !== null && param !== undefined && typeof param === "object" && !("generate" in param) && !("arbitrary" in param) && !("weight" in param);
}
function toWeightedArbitrary(maybeWeightedArbitrary) {
  if (isArbitrary(maybeWeightedArbitrary))
    return {
      arbitrary: maybeWeightedArbitrary,
      weight: 1
    };
  return maybeWeightedArbitrary;
}
function oneof(...args2) {
  const constraints = args2[0];
  if (isOneOfContraints(constraints)) {
    const weightedArbs2 = safeMap(safeSlice(args2, 1), toWeightedArbitrary);
    return FrequencyArbitrary.from(weightedArbs2, constraints, "fc.oneof");
  }
  const weightedArbs = safeMap(args2, toWeightedArbitrary);
  return FrequencyArbitrary.from(weightedArbs, {}, "fc.oneof");
}
var safeNumberIsInteger$3 = Number.isInteger;
function nat(arg) {
  const max4 = typeof arg === "number" ? arg : arg && arg.max !== undefined ? arg.max : 2147483647;
  if (max4 < 0)
    throw new Error("fc.nat value should be greater than or equal to 0");
  if (!safeNumberIsInteger$3(max4))
    throw new Error("fc.nat maximum value should be an integer");
  return new IntegerArbitrary(0, max4);
}
var safeObjectIs$2 = Object.is;
function buildDichotomyEntries(entries3) {
  let currentFrom = 0;
  const dichotomyEntries = [];
  for (const entry of entries3) {
    const from = currentFrom;
    currentFrom = from + entry.num;
    const to = currentFrom - 1;
    dichotomyEntries.push({
      from,
      to,
      entry
    });
  }
  return dichotomyEntries;
}
function findDichotomyEntry(dichotomyEntries, choiceIndex) {
  let min4 = 0;
  let max4 = dichotomyEntries.length;
  while (max4 - min4 > 1) {
    const mid = ~~((min4 + max4) / 2);
    if (choiceIndex < dichotomyEntries[mid].from)
      max4 = mid;
    else
      min4 = mid;
  }
  return dichotomyEntries[min4];
}
function indexToMappedConstantMapperFor(entries3) {
  const dichotomyEntries = buildDichotomyEntries(entries3);
  return function indexToMappedConstantMapper(choiceIndex) {
    const dichotomyEntry = findDichotomyEntry(dichotomyEntries, choiceIndex);
    return dichotomyEntry.entry.build(choiceIndex - dichotomyEntry.from);
  };
}
function buildReverseMapping(entries3) {
  const reverseMapping = {
    mapping: new SMap$1,
    negativeZeroIndex: undefined
  };
  let choiceIndex = 0;
  for (let entryIdx = 0;entryIdx !== entries3.length; ++entryIdx) {
    const entry = entries3[entryIdx];
    for (let idxInEntry = 0;idxInEntry !== entry.num; ++idxInEntry) {
      const value3 = entry.build(idxInEntry);
      if (value3 === 0 && 1 / value3 === SNumber.NEGATIVE_INFINITY)
        reverseMapping.negativeZeroIndex = choiceIndex;
      else
        safeMapSet(reverseMapping.mapping, value3, choiceIndex);
      ++choiceIndex;
    }
  }
  return reverseMapping;
}
function indexToMappedConstantUnmapperFor(entries3) {
  let reverseMapping = null;
  return function indexToMappedConstantUnmapper(value3) {
    if (reverseMapping === null)
      reverseMapping = buildReverseMapping(entries3);
    const choiceIndex = safeObjectIs$2(value3, -0) ? reverseMapping.negativeZeroIndex : safeMapGet(reverseMapping.mapping, value3);
    if (choiceIndex === undefined)
      throw new SError("Unknown value encountered cannot be built using this mapToConstant");
    return choiceIndex;
  };
}
function computeNumChoices(options) {
  if (options.length === 0)
    throw new SError(`fc.mapToConstant expects at least one option`);
  let numChoices = 0;
  for (let idx = 0;idx !== options.length; ++idx) {
    if (options[idx].num < 0)
      throw new SError(`fc.mapToConstant expects all options to have a number of entries greater or equal to zero`);
    numChoices += options[idx].num;
  }
  if (numChoices === 0)
    throw new SError(`fc.mapToConstant expects at least one choice among options`);
  return numChoices;
}
function mapToConstant(...entries3) {
  return nat({ max: computeNumChoices(entries3) - 1 }).map(indexToMappedConstantMapperFor(entries3), indexToMappedConstantUnmapperFor(entries3));
}
function tokenizeString(patternsArb, value3, minLength, maxLength) {
  if (value3.length === 0) {
    if (minLength > 0)
      return;
    return [];
  }
  if (maxLength <= 0)
    return;
  const stack = [{
    endIndexChunks: 0,
    nextStartIndex: 1,
    chunks: []
  }];
  while (stack.length > 0) {
    const last = safePop$1(stack);
    for (let index2 = last.nextStartIndex;index2 <= value3.length; ++index2) {
      const chunk = safeSubstring(value3, last.endIndexChunks, index2);
      if (patternsArb.canShrinkWithoutContext(chunk)) {
        const newChunks = [...last.chunks, chunk];
        if (index2 === value3.length) {
          if (newChunks.length < minLength)
            break;
          return newChunks;
        }
        safePush(stack, {
          endIndexChunks: last.endIndexChunks,
          nextStartIndex: index2 + 1,
          chunks: last.chunks
        });
        if (newChunks.length < maxLength)
          safePush(stack, {
            endIndexChunks: index2,
            nextStartIndex: index2 + 1,
            chunks: newChunks
          });
        break;
      }
    }
  }
}
function patternsToStringMapper(tab) {
  return safeJoin(tab, "");
}
function minLengthFrom(constraints) {
  return constraints.minLength !== undefined ? constraints.minLength : 0;
}
function maxLengthFrom(constraints) {
  return constraints.maxLength !== undefined ? constraints.maxLength : MaxLengthUpperBound;
}
function patternsToStringUnmapperIsValidLength(tokens, constraints) {
  return minLengthFrom(constraints) <= tokens.length && tokens.length <= maxLengthFrom(constraints);
}
function patternsToStringUnmapperFor(patternsArb, constraints) {
  return function patternsToStringUnmapper(value3) {
    if (typeof value3 !== "string")
      throw new SError("Unsupported value");
    const tokens = tokenizeString(patternsArb, value3, minLengthFrom(constraints), maxLengthFrom(constraints));
    if (tokens === undefined)
      throw new SError("Unable to unmap received string");
    return tokens;
  };
}
var dangerousStrings = [
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
  "apply",
  "arguments",
  "bind",
  "call",
  "caller",
  "length",
  "name",
  "prototype",
  "key",
  "ref"
];
function computeCandidateStringLegacy(dangerous, charArbitrary, stringSplitter) {
  let candidate;
  try {
    candidate = stringSplitter(dangerous);
  } catch {
    return;
  }
  for (const entry of candidate)
    if (!charArbitrary.canShrinkWithoutContext(entry))
      return;
  return candidate;
}
function createSlicesForStringLegacy(charArbitrary, stringSplitter) {
  const slicesForString = [];
  for (const dangerous of dangerousStrings) {
    const candidate = computeCandidateStringLegacy(dangerous, charArbitrary, stringSplitter);
    if (candidate !== undefined)
      safePush(slicesForString, candidate);
  }
  return slicesForString;
}
var slicesPerArbitrary = /* @__PURE__ */ new WeakMap;
function createSlicesForStringNoConstraints(charArbitrary) {
  const slicesForString = [];
  for (const dangerous of dangerousStrings) {
    const candidate = tokenizeString(charArbitrary, dangerous, 0, MaxLengthUpperBound);
    if (candidate !== undefined)
      safePush(slicesForString, candidate);
  }
  return slicesForString;
}
function createSlicesForString(charArbitrary, constraints) {
  let slices = safeGet(slicesPerArbitrary, charArbitrary);
  if (slices === undefined) {
    slices = createSlicesForStringNoConstraints(charArbitrary);
    safeSet(slicesPerArbitrary, charArbitrary, slices);
  }
  const slicesForConstraints = [];
  for (const slice of slices)
    if (patternsToStringUnmapperIsValidLength(slice, constraints))
      safePush(slicesForConstraints, slice);
  return slicesForConstraints;
}
var asciiAlphabetRanges = [[0, 127]];
var fullAlphabetRanges = [[0, 55295], [57344, 1114111]];
var autonomousGraphemeRanges = [
  [32, 126],
  [160, 172],
  [174, 767],
  [880, 887],
  [890, 895],
  [900, 906],
  [908],
  [910, 929],
  [931, 1154],
  [1162, 1327],
  [1329, 1366],
  [1369, 1418],
  [1421, 1423],
  [1470],
  [1472],
  [1475],
  [1478],
  [1488, 1514],
  [1519, 1524],
  [1542, 1551],
  [1563],
  [1565, 1610],
  [1632, 1647],
  [1649, 1749],
  [1758],
  [1765, 1766],
  [1769],
  [1774, 1805],
  [1808],
  [1810, 1839],
  [1869, 1957],
  [1969],
  [1984, 2026],
  [2036, 2042],
  [2046, 2069],
  [2074],
  [2084],
  [2088],
  [2096, 2110],
  [2112, 2136],
  [2142],
  [2144, 2154],
  [2160, 2190],
  [2208, 2249],
  [2308, 2361],
  [2365],
  [2384],
  [2392, 2401],
  [2404, 2432],
  [2437, 2444],
  [2447, 2448],
  [2451, 2472],
  [2474, 2480],
  [2482],
  [2486, 2489],
  [2493],
  [2510],
  [2524, 2525],
  [2527, 2529],
  [2534, 2557],
  [2565, 2570],
  [2575, 2576],
  [2579, 2600],
  [2602, 2608],
  [2610, 2611],
  [2613, 2614],
  [2616, 2617],
  [2649, 2652],
  [2654],
  [2662, 2671],
  [2674, 2676],
  [2678],
  [2693, 2701],
  [2703, 2705],
  [2707, 2728],
  [2730, 2736],
  [2738, 2739],
  [2741, 2745],
  [2749],
  [2768],
  [2784, 2785],
  [2790, 2801],
  [2809],
  [2821, 2828],
  [2831, 2832],
  [2835, 2856],
  [2858, 2864],
  [2866, 2867],
  [2869, 2873],
  [2877],
  [2908, 2909],
  [2911, 2913],
  [2918, 2935],
  [2947],
  [2949, 2954],
  [2958, 2960],
  [2962, 2965],
  [2969, 2970],
  [2972],
  [2974, 2975],
  [2979, 2980],
  [2984, 2986],
  [2990, 3001],
  [3024],
  [3046, 3066],
  [3077, 3084],
  [3086, 3088],
  [3090, 3112],
  [3114, 3129],
  [3133],
  [3160, 3162],
  [3165],
  [3168, 3169],
  [3174, 3183],
  [3191, 3200],
  [3204, 3212],
  [3214, 3216],
  [3218, 3240],
  [3242, 3251],
  [3253, 3257],
  [3261],
  [3293, 3294],
  [3296, 3297],
  [3302, 3311],
  [3313, 3314],
  [3332, 3340],
  [3342, 3344],
  [3346, 3386],
  [3389],
  [3407],
  [3412, 3414],
  [3416, 3425],
  [3430, 3455],
  [3461, 3478],
  [3482, 3505],
  [3507, 3515],
  [3517],
  [3520, 3526],
  [3558, 3567],
  [3572],
  [3585, 3632],
  [3634],
  [3647, 3654],
  [3663, 3675],
  [3713, 3714],
  [3716],
  [3718, 3722],
  [3724, 3747],
  [3749],
  [3751, 3760],
  [3762],
  [3773],
  [3776, 3780],
  [3782],
  [3792, 3801],
  [3804, 3807],
  [3840, 3863],
  [3866, 3892],
  [3894],
  [3896],
  [3898, 3901],
  [3904, 3911],
  [3913, 3948],
  [3973],
  [3976, 3980],
  [4030, 4037],
  [4039, 4044],
  [4046, 4058],
  [4096, 4138],
  [4159, 4181],
  [4186, 4189],
  [4193],
  [4197, 4198],
  [4206, 4208],
  [4213, 4225],
  [4238],
  [4240, 4249],
  [4254, 4293],
  [4295],
  [4301],
  [4304, 4351],
  [4608, 4680],
  [4682, 4685],
  [4688, 4694],
  [4696],
  [4698, 4701],
  [4704, 4744],
  [4746, 4749],
  [4752, 4784],
  [4786, 4789],
  [4792, 4798],
  [4800],
  [4802, 4805],
  [4808, 4822],
  [4824, 4880],
  [4882, 4885],
  [4888, 4954],
  [4960, 4988],
  [4992, 5017],
  [5024, 5109],
  [5112, 5117],
  [5120, 5788],
  [5792, 5880],
  [5888, 5905],
  [5919, 5937],
  [5941, 5942],
  [5952, 5969],
  [5984, 5996],
  [5998, 6000],
  [6016, 6067],
  [6100, 6108],
  [6112, 6121],
  [6128, 6137],
  [6144, 6154],
  [6160, 6169],
  [6176, 6264],
  [6272, 6276],
  [6279, 6312],
  [6314],
  [6320, 6389],
  [6400, 6430],
  [6464],
  [6468, 6509],
  [6512, 6516],
  [6528, 6571],
  [6576, 6601],
  [6608, 6618],
  [6622, 6678],
  [6686, 6740],
  [6784, 6793],
  [6800, 6809],
  [6816, 6829],
  [6917, 6963],
  [6981, 6988],
  [6992, 7018],
  [7028, 7038],
  [7043, 7072],
  [7086, 7141],
  [7164, 7203],
  [7227, 7241],
  [7245, 7304],
  [7312, 7354],
  [7357, 7367],
  [7379],
  [7401, 7404],
  [7406, 7411],
  [7413, 7414],
  [7418],
  [7424, 7615],
  [7680, 7957],
  [7960, 7965],
  [7968, 8005],
  [8008, 8013],
  [8016, 8023],
  [8025],
  [8027],
  [8029],
  [8031, 8061],
  [8064, 8116],
  [8118, 8132],
  [8134, 8147],
  [8150, 8155],
  [8157, 8175],
  [8178, 8180],
  [8182, 8190],
  [8192, 8202],
  [8208, 8233],
  [8239, 8287],
  [8304, 8305],
  [8308, 8334],
  [8336, 8348],
  [8352, 8384],
  [8448, 8587],
  [8592, 9254],
  [9280, 9290],
  [9312, 11123],
  [11126, 11157],
  [11159, 11502],
  [11506, 11507],
  [11513, 11557],
  [11559],
  [11565],
  [11568, 11623],
  [11631, 11632],
  [11648, 11670],
  [11680, 11686],
  [11688, 11694],
  [11696, 11702],
  [11704, 11710],
  [11712, 11718],
  [11720, 11726],
  [11728, 11734],
  [11736, 11742],
  [11776, 11869],
  [11904, 11929],
  [11931, 12019],
  [12032, 12245],
  [12272, 12329],
  [12336, 12351],
  [12353, 12438],
  [12443, 12543],
  [12549, 12591],
  [12593, 12686],
  [12688, 12771],
  [12783, 12830],
  [12832, 13312],
  [19903, 19968],
  [40959, 42124],
  [42128, 42182],
  [42192, 42539],
  [42560, 42606],
  [42611],
  [42622, 42653],
  [42656, 42735],
  [42738, 42743],
  [42752, 42954],
  [42960, 42961],
  [42963],
  [42965, 42969],
  [42994, 43009],
  [43011, 43013],
  [43015, 43018],
  [43020, 43042],
  [43048, 43051],
  [43056, 43065],
  [43072, 43127],
  [43138, 43187],
  [43214, 43225],
  [43250, 43262],
  [43264, 43301],
  [43310, 43334],
  [43359],
  [43396, 43442],
  [43457, 43469],
  [43471, 43481],
  [43486, 43492],
  [43494, 43518],
  [43520, 43560],
  [43584, 43586],
  [43588, 43595],
  [43600, 43609],
  [43612, 43642],
  [43646, 43695],
  [43697],
  [43701, 43702],
  [43705, 43709],
  [43712],
  [43714],
  [43739, 43754],
  [43760, 43764],
  [43777, 43782],
  [43785, 43790],
  [43793, 43798],
  [43808, 43814],
  [43816, 43822],
  [43824, 43883],
  [43888, 44002],
  [44011],
  [44016, 44025],
  [44032],
  [55203],
  [63744, 64109],
  [64112, 64217],
  [64256, 64262],
  [64275, 64279],
  [64285],
  [64287, 64310],
  [64312, 64316],
  [64318],
  [64320, 64321],
  [64323, 64324],
  [64326, 64450],
  [64467, 64911],
  [64914, 64967],
  [64975],
  [65008, 65023],
  [65040, 65049],
  [65072, 65106],
  [65108, 65126],
  [65128, 65131],
  [65136, 65140],
  [65142, 65276],
  [65281, 65437],
  [65440, 65470],
  [65474, 65479],
  [65482, 65487],
  [65490, 65495],
  [65498, 65500],
  [65504, 65510],
  [65512, 65518],
  [65532, 65533],
  [65536, 65547],
  [65549, 65574],
  [65576, 65594],
  [65596, 65597],
  [65599, 65613],
  [65616, 65629],
  [65664, 65786],
  [65792, 65794],
  [65799, 65843],
  [65847, 65934],
  [65936, 65948],
  [65952],
  [66000, 66044],
  [66176, 66204],
  [66208, 66256],
  [66273, 66299],
  [66304, 66339],
  [66349, 66378],
  [66384, 66421],
  [66432, 66461],
  [66463, 66499],
  [66504, 66517],
  [66560, 66717],
  [66720, 66729],
  [66736, 66771],
  [66776, 66811],
  [66816, 66855],
  [66864, 66915],
  [66927, 66938],
  [66940, 66954],
  [66956, 66962],
  [66964, 66965],
  [66967, 66977],
  [66979, 66993],
  [66995, 67001],
  [67003, 67004],
  [67072, 67382],
  [67392, 67413],
  [67424, 67431],
  [67456, 67461],
  [67463, 67504],
  [67506, 67514],
  [67584, 67589],
  [67592],
  [67594, 67637],
  [67639, 67640],
  [67644],
  [67647, 67669],
  [67671, 67742],
  [67751, 67759],
  [67808, 67826],
  [67828, 67829],
  [67835, 67867],
  [67871, 67897],
  [67903],
  [67968, 68023],
  [68028, 68047],
  [68050, 68096],
  [68112, 68115],
  [68117, 68119],
  [68121, 68149],
  [68160, 68168],
  [68176, 68184],
  [68192, 68255],
  [68288, 68324],
  [68331, 68342],
  [68352, 68405],
  [68409, 68437],
  [68440, 68466],
  [68472, 68497],
  [68505, 68508],
  [68521, 68527],
  [68608, 68680],
  [68736, 68786],
  [68800, 68850],
  [68858, 68899],
  [68912, 68921],
  [69216, 69246],
  [69248, 69289],
  [69293],
  [69296, 69297],
  [69376, 69415],
  [69424, 69445],
  [69457, 69465],
  [69488, 69505],
  [69510, 69513],
  [69552, 69579],
  [69600, 69622],
  [69635, 69687],
  [69703, 69709],
  [69714, 69743],
  [69745, 69746],
  [69749],
  [69763, 69807],
  [69819, 69820],
  [69822, 69825],
  [69840, 69864],
  [69872, 69881],
  [69891, 69926],
  [69942, 69956],
  [69959],
  [69968, 70002],
  [70004, 70006],
  [70019, 70066],
  [70081],
  [70084, 70088],
  [70093],
  [70096, 70111],
  [70113, 70132],
  [70144, 70161],
  [70163, 70187],
  [70200, 70205],
  [70207, 70208],
  [70272, 70278],
  [70280],
  [70282, 70285],
  [70287, 70301],
  [70303, 70313],
  [70320, 70366],
  [70384, 70393],
  [70405, 70412],
  [70415, 70416],
  [70419, 70440],
  [70442, 70448],
  [70450, 70451],
  [70453, 70457],
  [70461],
  [70480],
  [70493, 70497],
  [70656, 70708],
  [70727, 70747],
  [70749],
  [70751, 70753],
  [70784, 70831],
  [70852, 70855],
  [70864, 70873],
  [71040, 71086],
  [71105, 71131],
  [71168, 71215],
  [71233, 71236],
  [71248, 71257],
  [71264, 71276],
  [71296, 71338],
  [71352, 71353],
  [71360, 71369],
  [71424, 71450],
  [71472, 71494],
  [71680, 71723],
  [71739],
  [71840, 71922],
  [71935, 71942],
  [71945],
  [71948, 71955],
  [71957, 71958],
  [71960, 71983],
  [72004, 72006],
  [72016, 72025],
  [72096, 72103],
  [72106, 72144],
  [72161, 72163],
  [72192],
  [72203, 72242],
  [72255, 72262],
  [72272],
  [72284, 72323],
  [72346, 72354],
  [72368, 72440],
  [72448, 72457],
  [72704, 72712],
  [72714, 72750],
  [72768, 72773],
  [72784, 72812],
  [72816, 72847],
  [72960, 72966],
  [72968, 72969],
  [72971, 73008],
  [73040, 73049],
  [73056, 73061],
  [73063, 73064],
  [73066, 73097],
  [73112],
  [73120, 73129],
  [73440, 73458],
  [73463, 73464],
  [73476, 73488],
  [73490, 73523],
  [73539, 73561],
  [73648],
  [73664, 73713],
  [73727, 74649],
  [74752, 74862],
  [74864, 74868],
  [74880, 75075],
  [77712, 77810],
  [77824, 78895],
  [78913, 78918],
  [82944, 83526],
  [92160, 92728],
  [92736, 92766],
  [92768, 92777],
  [92782, 92862],
  [92864, 92873],
  [92880, 92909],
  [92917],
  [92928, 92975],
  [92983, 92997],
  [93008, 93017],
  [93019, 93025],
  [93027, 93047],
  [93053, 93071],
  [93760, 93850],
  [93952, 94026],
  [94032],
  [94099, 94111],
  [94176, 94179],
  [94208],
  [100343],
  [100352, 101589],
  [101632],
  [101640],
  [110576, 110579],
  [110581, 110587],
  [110589, 110590],
  [110592, 110882],
  [110898],
  [110928, 110930],
  [110933],
  [110948, 110951],
  [110960, 111355],
  [113664, 113770],
  [113776, 113788],
  [113792, 113800],
  [113808, 113817],
  [113820],
  [113823],
  [118608, 118723],
  [118784, 119029],
  [119040, 119078],
  [119081, 119140],
  [119146, 119148],
  [119171, 119172],
  [119180, 119209],
  [119214, 119274],
  [119296, 119361],
  [119365],
  [119488, 119507],
  [119520, 119539],
  [119552, 119638],
  [119648, 119672],
  [119808, 119892],
  [119894, 119964],
  [119966, 119967],
  [119970],
  [119973, 119974],
  [119977, 119980],
  [119982, 119993],
  [119995],
  [119997, 120003],
  [120005, 120069],
  [120071, 120074],
  [120077, 120084],
  [120086, 120092],
  [120094, 120121],
  [120123, 120126],
  [120128, 120132],
  [120134],
  [120138, 120144],
  [120146, 120485],
  [120488, 120779],
  [120782, 121343],
  [121399, 121402],
  [121453, 121460],
  [121462, 121475],
  [121477, 121483],
  [122624, 122654],
  [122661, 122666],
  [122928, 122989],
  [123136, 123180],
  [123191, 123197],
  [123200, 123209],
  [123214, 123215],
  [123536, 123565],
  [123584, 123627],
  [123632, 123641],
  [123647],
  [124112, 124139],
  [124144, 124153],
  [124896, 124902],
  [124904, 124907],
  [124909, 124910],
  [124912, 124926],
  [124928, 125124],
  [125127, 125135],
  [125184, 125251],
  [125259],
  [125264, 125273],
  [125278, 125279],
  [126065, 126132],
  [126209, 126269],
  [126464, 126467],
  [126469, 126495],
  [126497, 126498],
  [126500],
  [126503],
  [126505, 126514],
  [126516, 126519],
  [126521],
  [126523],
  [126530],
  [126535],
  [126537],
  [126539],
  [126541, 126543],
  [126545, 126546],
  [126548],
  [126551],
  [126553],
  [126555],
  [126557],
  [126559],
  [126561, 126562],
  [126564],
  [126567, 126570],
  [126572, 126578],
  [126580, 126583],
  [126585, 126588],
  [126590],
  [126592, 126601],
  [126603, 126619],
  [126625, 126627],
  [126629, 126633],
  [126635, 126651],
  [126704, 126705],
  [126976, 127019],
  [127024, 127123],
  [127136, 127150],
  [127153, 127167],
  [127169, 127183],
  [127185, 127221],
  [127232, 127405],
  [127488, 127490],
  [127504, 127547],
  [127552, 127560],
  [127568, 127569],
  [127584, 127589],
  [127744, 127994],
  [128000, 128727],
  [128732, 128748],
  [128752, 128764],
  [128768, 128886],
  [128891, 128985],
  [128992, 129003],
  [129008],
  [129024, 129035],
  [129040, 129095],
  [129104, 129113],
  [129120, 129159],
  [129168, 129197],
  [129200, 129201],
  [129280, 129619],
  [129632, 129645],
  [129648, 129660],
  [129664, 129672],
  [129680, 129725],
  [129727, 129733],
  [129742, 129755],
  [129760, 129768],
  [129776, 129784],
  [129792, 129938],
  [129940, 129994],
  [130032, 130041],
  [131072],
  [173791],
  [173824],
  [177977],
  [177984],
  [178205],
  [178208],
  [183969],
  [183984],
  [191456],
  [191472],
  [192093],
  [194560, 195101],
  [196608],
  [201546],
  [201552],
  [205743]
];
var autonomousDecomposableGraphemeRanges = [
  [192, 197],
  [199, 207],
  [209, 214],
  [217, 221],
  [224, 229],
  [231, 239],
  [241, 246],
  [249, 253],
  [255, 271],
  [274, 293],
  [296, 304],
  [308, 311],
  [313, 318],
  [323, 328],
  [332, 337],
  [340, 357],
  [360, 382],
  [416, 417],
  [431, 432],
  [461, 476],
  [478, 483],
  [486, 496],
  [500, 501],
  [504, 539],
  [542, 543],
  [550, 563],
  [901, 902],
  [904, 906],
  [908],
  [910, 912],
  [938, 944],
  [970, 974],
  [979, 980],
  [1024, 1025],
  [1027],
  [1031],
  [1036, 1038],
  [1049],
  [1081],
  [1104, 1105],
  [1107],
  [1111],
  [1116, 1118],
  [1142, 1143],
  [1217, 1218],
  [1232, 1235],
  [1238, 1239],
  [1242, 1247],
  [1250, 1255],
  [1258, 1269],
  [1272, 1273],
  [1570, 1574],
  [1728],
  [1730],
  [1747],
  [2345],
  [2353],
  [2356],
  [2392, 2399],
  [2524, 2525],
  [2527],
  [2611],
  [2614],
  [2649, 2651],
  [2654],
  [2908, 2909],
  [2964],
  [3907],
  [3917],
  [3922],
  [3927],
  [3932],
  [3945],
  [4134],
  [6918],
  [6920],
  [6922],
  [6924],
  [6926],
  [6930],
  [7680, 7833],
  [7835],
  [7840, 7929],
  [7936, 7957],
  [7960, 7965],
  [7968, 8005],
  [8008, 8013],
  [8016, 8023],
  [8025],
  [8027],
  [8029],
  [8031, 8048],
  [8050],
  [8052],
  [8054],
  [8056],
  [8058],
  [8060],
  [8064, 8116],
  [8118, 8122],
  [8124],
  [8129, 8132],
  [8134, 8136],
  [8138],
  [8140, 8146],
  [8150, 8154],
  [8157, 8162],
  [8164, 8170],
  [8172, 8173],
  [8178, 8180],
  [8182, 8184],
  [8186],
  [8188],
  [8602, 8603],
  [8622],
  [8653, 8655],
  [8708],
  [8713],
  [8716],
  [8740],
  [8742],
  [8769],
  [8772],
  [8775],
  [8777],
  [8800],
  [8802],
  [8813, 8817],
  [8820, 8821],
  [8824, 8825],
  [8832, 8833],
  [8836, 8837],
  [8840, 8841],
  [8876, 8879],
  [8928, 8931],
  [8938, 8941],
  [10972],
  [12364],
  [12366],
  [12368],
  [12370],
  [12372],
  [12374],
  [12376],
  [12378],
  [12380],
  [12382],
  [12384],
  [12386],
  [12389],
  [12391],
  [12393],
  [12400, 12401],
  [12403, 12404],
  [12406, 12407],
  [12409, 12410],
  [12412, 12413],
  [12436],
  [12446],
  [12460],
  [12462],
  [12464],
  [12466],
  [12468],
  [12470],
  [12472],
  [12474],
  [12476],
  [12478],
  [12480],
  [12482],
  [12485],
  [12487],
  [12489],
  [12496, 12497],
  [12499, 12500],
  [12502, 12503],
  [12505, 12506],
  [12508, 12509],
  [12532],
  [12535, 12538],
  [12542],
  [44032],
  [55203],
  [64285],
  [64287],
  [64298, 64310],
  [64312, 64316],
  [64318],
  [64320, 64321],
  [64323, 64324],
  [64326, 64334],
  [69786],
  [69788],
  [69803],
  [119134, 119140],
  [119227, 119232]
];
var safeStringFromCodePoint$3 = String.fromCodePoint;
var safeMathMin$2 = Math.min;
var safeMathMax$1 = Math.max;
function convertGraphemeRangeToMapToConstantEntry(range) {
  if (range.length === 1) {
    const codePointString = safeStringFromCodePoint$3(range[0]);
    return {
      num: 1,
      build: () => codePointString
    };
  }
  const rangeStart = range[0];
  return {
    num: range[1] - range[0] + 1,
    build: (idInGroup) => safeStringFromCodePoint$3(rangeStart + idInGroup)
  };
}
function intersectGraphemeRanges(rangesA, rangesB) {
  const mergedRanges = [];
  let cursorA = 0;
  let cursorB = 0;
  while (cursorA < rangesA.length && cursorB < rangesB.length) {
    const rangeA = rangesA[cursorA];
    const rangeAMin = rangeA[0];
    const rangeAMax = rangeA.length === 1 ? rangeA[0] : rangeA[1];
    const rangeB = rangesB[cursorB];
    const rangeBMin = rangeB[0];
    const rangeBMax = rangeB.length === 1 ? rangeB[0] : rangeB[1];
    if (rangeAMax < rangeBMin)
      cursorA += 1;
    else if (rangeBMax < rangeAMin)
      cursorB += 1;
    else {
      let min4 = safeMathMax$1(rangeAMin, rangeBMin);
      const max4 = safeMathMin$2(rangeAMax, rangeBMax);
      if (mergedRanges.length >= 1) {
        const lastMergedRange = mergedRanges[mergedRanges.length - 1];
        if ((lastMergedRange.length === 1 ? lastMergedRange[0] : lastMergedRange[1]) + 1 === min4) {
          min4 = lastMergedRange[0];
          safePop$1(mergedRanges);
        }
      }
      safePush(mergedRanges, min4 === max4 ? [min4] : [min4, max4]);
      if (rangeAMax <= max4)
        cursorA += 1;
      if (rangeBMax <= max4)
        cursorB += 1;
    }
  }
  return mergedRanges;
}
var registeredStringUnitInstancesMap = Object.create(null);
function getAlphabetRanges(alphabet) {
  switch (alphabet) {
    case "full":
      return fullAlphabetRanges;
    case "ascii":
      return asciiAlphabetRanges;
  }
}
function getOrCreateStringUnitInstance(type, alphabet) {
  const key = `${type}:${alphabet}`;
  const registered = registeredStringUnitInstancesMap[key];
  if (registered !== undefined)
    return registered;
  const alphabetRanges = getAlphabetRanges(alphabet);
  const ranges = type === "binary" ? alphabetRanges : intersectGraphemeRanges(alphabetRanges, autonomousGraphemeRanges);
  const entries3 = [];
  for (const range of ranges)
    safePush(entries3, convertGraphemeRangeToMapToConstantEntry(range));
  if (type === "grapheme") {
    const decomposedRanges = intersectGraphemeRanges(alphabetRanges, autonomousDecomposableGraphemeRanges);
    for (const range of decomposedRanges) {
      const rawEntry = convertGraphemeRangeToMapToConstantEntry(range);
      safePush(entries3, {
        num: rawEntry.num,
        build: (idInGroup) => safeNormalize(rawEntry.build(idInGroup), "NFD")
      });
    }
  }
  const stringUnitInstance = mapToConstant(...entries3);
  registeredStringUnitInstancesMap[key] = stringUnitInstance;
  return stringUnitInstance;
}
function stringUnit(type, alphabet) {
  return getOrCreateStringUnitInstance(type, alphabet);
}
function extractUnitArbitrary(constraints) {
  if (typeof constraints.unit === "object")
    return constraints.unit;
  switch (constraints.unit) {
    case "grapheme":
      return stringUnit("grapheme", "full");
    case "grapheme-composite":
      return stringUnit("composite", "full");
    case "grapheme-ascii":
    case undefined:
      return stringUnit("grapheme", "ascii");
    case "binary":
      return stringUnit("binary", "full");
    case "binary-ascii":
      return stringUnit("binary", "ascii");
  }
}
function string3(constraints = {}) {
  const charArbitrary = extractUnitArbitrary(constraints);
  const unmapper = patternsToStringUnmapperFor(charArbitrary, constraints);
  const experimentalCustomSlices = createSlicesForString(charArbitrary, constraints);
  return array3(charArbitrary, {
    ...constraints,
    experimentalCustomSlices
  }).map(patternsToStringMapper, unmapper);
}
var SMap = Map;
var safeStringFromCharCode$1 = String.fromCharCode;
var lowerCaseMapper = {
  num: 26,
  build: (v) => safeStringFromCharCode$1(v + 97)
};
var upperCaseMapper = {
  num: 26,
  build: (v) => safeStringFromCharCode$1(v + 65)
};
var numericMapper = {
  num: 10,
  build: (v) => safeStringFromCharCode$1(v + 48)
};
function percentCharArbMapper(c) {
  const encoded = SencodeURIComponent(c);
  return c !== encoded ? encoded : `%${safeNumberToString(safeCharCodeAt(c, 0), 16)}`;
}
function percentCharArbUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Unsupported");
  return decodeURIComponent(value3);
}
var percentCharArb = () => string3({
  unit: "binary",
  minLength: 1,
  maxLength: 1
}).map(percentCharArbMapper, percentCharArbUnmapper);
var lowerAlphaArbitrary = undefined;
function getOrCreateLowerAlphaArbitrary() {
  if (lowerAlphaArbitrary === undefined)
    lowerAlphaArbitrary = mapToConstant(lowerCaseMapper);
  return lowerAlphaArbitrary;
}
var lowerAlphaNumericArbitraries = undefined;
function getOrCreateLowerAlphaNumericArbitrary(others) {
  if (lowerAlphaNumericArbitraries === undefined)
    lowerAlphaNumericArbitraries = new SMap;
  let match7 = safeMapGet(lowerAlphaNumericArbitraries, others);
  if (match7 === undefined) {
    match7 = mapToConstant(lowerCaseMapper, numericMapper, {
      num: others.length,
      build: (v) => others[v]
    });
    safeMapSet(lowerAlphaNumericArbitraries, others, match7);
  }
  return match7;
}
function buildAlphaNumericArbitrary(others) {
  return mapToConstant(lowerCaseMapper, upperCaseMapper, numericMapper, {
    num: others.length,
    build: (v) => others[v]
  });
}
var alphaNumericPercentArbitraries = undefined;
function getOrCreateAlphaNumericPercentArbitrary(others) {
  if (alphaNumericPercentArbitraries === undefined)
    alphaNumericPercentArbitraries = new SMap;
  let match7 = safeMapGet(alphaNumericPercentArbitraries, others);
  if (match7 === undefined) {
    match7 = oneof({
      weight: 10,
      arbitrary: buildAlphaNumericArbitrary(others)
    }, {
      weight: 1,
      arbitrary: percentCharArb()
    });
    safeMapSet(alphaNumericPercentArbitraries, others, match7);
  }
  return match7;
}
function option2(arb, constraints = {}) {
  const freq = constraints.freq === undefined ? 6 : constraints.freq;
  const nilValue = safeHasOwnProperty(constraints, "nil") ? constraints.nil : null;
  const weightedArbs = [{
    arbitrary: constant2(nilValue),
    weight: 1,
    fallbackValue: { default: nilValue }
  }, {
    arbitrary: arb,
    weight: freq - 1
  }];
  const frequencyConstraints = {
    withCrossShrink: true,
    depthSize: constraints.depthSize,
    maxDepth: constraints.maxDepth,
    depthIdentifier: constraints.depthIdentifier
  };
  return FrequencyArbitrary.from(weightedArbs, frequencyConstraints, "fc.option");
}
function filterInvalidSubdomainLabel(subdomainLabel) {
  if (subdomainLabel.length > 63)
    return false;
  return subdomainLabel.length < 4 || subdomainLabel[0] !== "x" || subdomainLabel[1] !== "n" || subdomainLabel[2] !== "-" || subdomainLabel[3] !== "-";
}
var AdaptedValue = Symbol("adapted-value");
function toAdapterValue(rawValue, adapter) {
  const adapted = adapter(rawValue.value_);
  if (!adapted.adapted)
    return rawValue;
  return new Value(adapted.value, AdaptedValue);
}
var AdapterArbitrary = class extends Arbitrary {
  constructor(sourceArb, adapter) {
    super();
    this.sourceArb = sourceArb;
    this.adapter = adapter;
    this.adaptValue = (rawValue) => toAdapterValue(rawValue, adapter);
  }
  generate(mrng, biasFactor) {
    const rawValue = this.sourceArb.generate(mrng, biasFactor);
    return this.adaptValue(rawValue);
  }
  canShrinkWithoutContext(value3) {
    return this.sourceArb.canShrinkWithoutContext(value3) && !this.adapter(value3).adapted;
  }
  shrink(value3, context3) {
    if (context3 === AdaptedValue) {
      if (!this.sourceArb.canShrinkWithoutContext(value3))
        return Stream.nil();
      return this.sourceArb.shrink(value3, undefined).map(this.adaptValue);
    }
    return this.sourceArb.shrink(value3, context3).map(this.adaptValue);
  }
};
function adapter(sourceArb, adapter2) {
  return new AdapterArbitrary(sourceArb, adapter2);
}
function toSubdomainLabelMapper([f, d]) {
  return d === null ? f : `${f}${d[0]}${d[1]}`;
}
function toSubdomainLabelUnmapper(value3) {
  if (typeof value3 !== "string" || value3.length === 0)
    throw new Error("Unsupported");
  if (value3.length === 1)
    return [value3[0], null];
  return [value3[0], [safeSubstring(value3, 1, value3.length - 1), value3[value3.length - 1]]];
}
function subdomainLabel(size6) {
  const alphaNumericArb = getOrCreateLowerAlphaNumericArbitrary("");
  return tuple2(alphaNumericArb, option2(tuple2(string3({
    unit: getOrCreateLowerAlphaNumericArbitrary("-"),
    size: size6,
    maxLength: 61
  }), alphaNumericArb))).map(toSubdomainLabelMapper, toSubdomainLabelUnmapper).filter(filterInvalidSubdomainLabel);
}
function labelsMapper(elements) {
  return `${safeJoin(elements[0], ".")}.${elements[1]}`;
}
function labelsUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Unsupported type");
  const lastDotIndex = value3.lastIndexOf(".");
  return [safeSplit(safeSubstring(value3, 0, lastDotIndex), "."), safeSubstring(value3, lastDotIndex + 1)];
}
function labelsAdapter(labels) {
  const [subDomains, suffix] = labels;
  let lengthNotIncludingIndex = suffix.length;
  for (let index2 = 0;index2 !== subDomains.length; ++index2) {
    lengthNotIncludingIndex += 1 + subDomains[index2].length;
    if (lengthNotIncludingIndex > 255)
      return {
        adapted: true,
        value: [safeSlice(subDomains, 0, index2), suffix]
      };
  }
  return {
    adapted: false,
    value: labels
  };
}
function domain(constraints = {}) {
  const resolvedSize = resolveSize(constraints.size);
  const resolvedSizeMinusOne = relativeSizeToSize("-1", resolvedSize);
  const publicSuffixArb = string3({
    unit: getOrCreateLowerAlphaArbitrary(),
    minLength: 2,
    maxLength: 63,
    size: resolvedSizeMinusOne
  });
  return adapter(tuple2(array3(subdomainLabel(resolvedSize), {
    size: resolvedSizeMinusOne,
    minLength: 1,
    maxLength: 127
  }), publicSuffixArb), labelsAdapter).map(labelsMapper, labelsUnmapper);
}
function dotAdapter(a) {
  let currentLength = a[0].length;
  for (let index2 = 1;index2 !== a.length; ++index2) {
    currentLength += 1 + a[index2].length;
    if (currentLength > 64)
      return {
        adapted: true,
        value: safeSlice(a, 0, index2)
      };
  }
  return {
    adapted: false,
    value: a
  };
}
function dotMapper(a) {
  return safeJoin(a, ".");
}
function dotUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Unsupported");
  return safeSplit(value3, ".");
}
function atMapper(data) {
  return `${data[0]}@${data[1]}`;
}
function atUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Unsupported");
  return safeSplit(value3, "@", 2);
}
function emailAddress(constraints = {}) {
  return tuple2(adapter(array3(string3({
    unit: getOrCreateLowerAlphaNumericArbitrary("!#$%&'*+-/=?^_`{|}~"),
    minLength: 1,
    maxLength: 64,
    size: constraints.size
  }), {
    minLength: 1,
    maxLength: 32,
    size: constraints.size
  }), dotAdapter).map(dotMapper, dotUnmapper), domain({ size: constraints.size })).map(atMapper, atUnmapper);
}
var safeNegativeInfinity$6 = SNumber.NEGATIVE_INFINITY;
var safePositiveInfinity$6 = SNumber.POSITIVE_INFINITY;
var safeEpsilon = SNumber.EPSILON;
var INDEX_POSITIVE_INFINITY$1 = SBigInt2(2146435072) * SBigInt2(4294967296);
var INDEX_NEGATIVE_INFINITY$1 = -INDEX_POSITIVE_INFINITY$1 - SBigInt2(1);
var num2Pow52 = 4503599627370496;
var big2Pow52Mask = SBigInt2(4503599627370495);
var big2Pow53 = SBigInt2("9007199254740992");
var f64 = new Float64Array(1);
var u32$1 = new Uint32Array(f64.buffer, f64.byteOffset);
function bitCastDoubleToUInt64(f) {
  f64[0] = f;
  return [u32$1[1], u32$1[0]];
}
function decomposeDouble(d) {
  const { 0: hi, 1: lo } = bitCastDoubleToUInt64(d);
  const signBit = hi >>> 31;
  const exponentBits = hi >>> 20 & 2047;
  const significandBits = (hi & 1048575) * 4294967296 + lo;
  const exponent = exponentBits === 0 ? -1022 : exponentBits - 1023;
  let significand = exponentBits === 0 ? 0 : 1;
  significand += significandBits * safeEpsilon;
  significand *= signBit === 0 ? 1 : -1;
  return {
    exponent,
    significand
  };
}
function indexInDoubleFromDecomp(exponent, significand) {
  if (exponent === -1022)
    return SBigInt2(significand * num2Pow52);
  return SBigInt2((significand - 1) * num2Pow52) + (SBigInt2(exponent + 1023) << SBigInt2(52));
}
function doubleToIndex(d) {
  if (d === safePositiveInfinity$6)
    return INDEX_POSITIVE_INFINITY$1;
  if (d === safeNegativeInfinity$6)
    return INDEX_NEGATIVE_INFINITY$1;
  const decomp = decomposeDouble(d);
  const exponent = decomp.exponent;
  const significand = decomp.significand;
  if (d > 0 || d === 0 && 1 / d === safePositiveInfinity$6)
    return indexInDoubleFromDecomp(exponent, significand);
  else
    return -indexInDoubleFromDecomp(exponent, -significand) - SBigInt2(1);
}
function indexToDouble(index2) {
  if (index2 < 0)
    return -indexToDouble(-index2 - SBigInt2(1));
  if (index2 === INDEX_POSITIVE_INFINITY$1)
    return safePositiveInfinity$6;
  if (index2 < big2Pow53)
    return SNumber(index2) * 2 ** -1074;
  const postIndex = index2 - big2Pow53;
  const exponent = -1021 + SNumber(postIndex >> SBigInt2(52));
  return (1 + SNumber(postIndex & big2Pow52Mask) * safeEpsilon) * 2 ** exponent;
}
var safeNumberIsInteger$2 = Number.isInteger;
var safeObjectIs$1 = Object.is;
var safeNegativeInfinity$5 = Number.NEGATIVE_INFINITY;
var safePositiveInfinity$5 = Number.POSITIVE_INFINITY;
function refineConstraintsForFloatingOnly(constraints, maxValue, maxNonIntegerValue, onlyIntegersAfterThisValue) {
  const { noDefaultInfinity = false, minExcluded = false, maxExcluded = false, min: min4 = noDefaultInfinity ? -maxValue : safeNegativeInfinity$5, max: max4 = noDefaultInfinity ? maxValue : safePositiveInfinity$5 } = constraints;
  const effectiveMin = minExcluded ? min4 < -maxNonIntegerValue ? -onlyIntegersAfterThisValue : Math.max(min4, -maxNonIntegerValue) : min4 === safeNegativeInfinity$5 ? Math.max(min4, -onlyIntegersAfterThisValue) : Math.max(min4, -maxNonIntegerValue);
  const effectiveMax = maxExcluded ? max4 > maxNonIntegerValue ? onlyIntegersAfterThisValue : Math.min(max4, maxNonIntegerValue) : max4 === safePositiveInfinity$5 ? Math.min(max4, onlyIntegersAfterThisValue) : Math.min(max4, maxNonIntegerValue);
  return {
    noDefaultInfinity: false,
    minExcluded: minExcluded || (min4 !== safeNegativeInfinity$5 || minExcluded) && safeNumberIsInteger$2(effectiveMin),
    maxExcluded: maxExcluded || (max4 !== safePositiveInfinity$5 || maxExcluded) && safeNumberIsInteger$2(effectiveMax),
    min: safeObjectIs$1(effectiveMin, -0) ? 0 : effectiveMin,
    max: safeObjectIs$1(effectiveMax, 0) ? -0 : effectiveMax,
    noNaN: constraints.noNaN || false
  };
}
var safeNegativeInfinity$4 = Number.NEGATIVE_INFINITY;
var safePositiveInfinity$4 = Number.POSITIVE_INFINITY;
var safeMaxValue$2 = Number.MAX_VALUE;
var maxNonIntegerValue$1 = 4503599627370495.5;
var onlyIntegersAfterThisValue$1 = 4503599627370496;
function refineConstraintsForDoubleOnly(constraints) {
  return refineConstraintsForFloatingOnly(constraints, safeMaxValue$2, maxNonIntegerValue$1, onlyIntegersAfterThisValue$1);
}
function doubleOnlyMapper(value3) {
  return value3 === 4503599627370496 ? safePositiveInfinity$4 : value3 === -4503599627370496 ? safeNegativeInfinity$4 : value3;
}
function doubleOnlyUnmapper(value3) {
  if (typeof value3 !== "number")
    throw new Error("Unsupported type");
  return value3 === safePositiveInfinity$4 ? onlyIntegersAfterThisValue$1 : value3 === safeNegativeInfinity$4 ? -onlyIntegersAfterThisValue$1 : value3;
}
var safeNumberIsInteger$1 = Number.isInteger;
var safeNumberIsNaN$1 = Number.isNaN;
var safeNegativeInfinity$3 = Number.NEGATIVE_INFINITY;
var safePositiveInfinity$3 = Number.POSITIVE_INFINITY;
var safeMaxValue$1 = Number.MAX_VALUE;
var safeNaN$1 = NaN;
function safeDoubleToIndex(d, constraintsLabel) {
  if (safeNumberIsNaN$1(d))
    throw new Error("fc.double constraints." + constraintsLabel + " must be a 64-bit float");
  return doubleToIndex(d);
}
function unmapperDoubleToIndex(value3) {
  if (typeof value3 !== "number")
    throw new Error("Unsupported type");
  return doubleToIndex(value3);
}
function numberIsNotInteger$1(value3) {
  return !safeNumberIsInteger$1(value3);
}
function anyDouble(constraints) {
  const { noDefaultInfinity = false, noNaN = false, minExcluded = false, maxExcluded = false, min: min4 = noDefaultInfinity ? -safeMaxValue$1 : safeNegativeInfinity$3, max: max4 = noDefaultInfinity ? safeMaxValue$1 : safePositiveInfinity$3 } = constraints;
  const minIndexRaw = safeDoubleToIndex(min4, "min");
  const minIndex = minExcluded ? minIndexRaw + SBigInt2(1) : minIndexRaw;
  const maxIndexRaw = safeDoubleToIndex(max4, "max");
  const maxIndex = maxExcluded ? maxIndexRaw - SBigInt2(1) : maxIndexRaw;
  if (maxIndex < minIndex)
    throw new Error("fc.double constraints.min must be smaller or equal to constraints.max");
  if (noNaN)
    return bigInt2({
      min: minIndex,
      max: maxIndex
    }).map(indexToDouble, unmapperDoubleToIndex);
  const positiveMaxIdx = maxIndex > SBigInt2(0);
  const minIndexWithNaN = positiveMaxIdx ? minIndex : minIndex - SBigInt2(1);
  const maxIndexWithNaN = positiveMaxIdx ? maxIndex + SBigInt2(1) : maxIndex;
  return bigInt2({
    min: minIndexWithNaN,
    max: maxIndexWithNaN
  }).map((index2) => {
    if (maxIndex < index2 || index2 < minIndex)
      return safeNaN$1;
    else
      return indexToDouble(index2);
  }, (value3) => {
    if (typeof value3 !== "number")
      throw new Error("Unsupported type");
    if (safeNumberIsNaN$1(value3))
      return maxIndex !== maxIndexWithNaN ? maxIndexWithNaN : minIndexWithNaN;
    return doubleToIndex(value3);
  });
}
function double(constraints = {}) {
  if (!constraints.noInteger)
    return anyDouble(constraints);
  return anyDouble(refineConstraintsForDoubleOnly(constraints)).map(doubleOnlyMapper, doubleOnlyUnmapper).filter(numberIsNotInteger$1);
}
var safeNegativeInfinity$2 = Number.NEGATIVE_INFINITY;
var safePositiveInfinity$2 = Number.POSITIVE_INFINITY;
var safeMathImul = Math.imul;
var MAX_VALUE_32 = 2 ** 127 * (1 + (2 ** 23 - 1) / 2 ** 23);
var INDEX_POSITIVE_INFINITY = 2139095040;
var INDEX_NEGATIVE_INFINITY = -2139095041;
var f32 = new Float32Array(1);
var u32 = new Uint32Array(f32.buffer, f32.byteOffset);
function bitCastFloatToUInt32(f) {
  f32[0] = f;
  return u32[0];
}
function decomposeFloat(f) {
  const bits = bitCastFloatToUInt32(f);
  const signBit = bits >>> 31;
  const exponentBits = bits >>> 23 & 255;
  const significandBits = bits & 8388607;
  const exponent = exponentBits === 0 ? -126 : exponentBits - 127;
  let significand = exponentBits === 0 ? 0 : 1;
  significand += significandBits / 2 ** 23;
  significand *= signBit === 0 ? 1 : -1;
  return {
    exponent,
    significand
  };
}
function indexInFloatFromDecomp(exponent, significand) {
  if (exponent === -126)
    return significand * 8388608;
  return safeMathImul(exponent + 127, 8388608) + (significand - 1) * 8388608;
}
function floatToIndex(f) {
  if (f === safePositiveInfinity$2)
    return INDEX_POSITIVE_INFINITY;
  if (f === safeNegativeInfinity$2)
    return INDEX_NEGATIVE_INFINITY;
  const decomp = decomposeFloat(f);
  const exponent = decomp.exponent;
  const significand = decomp.significand;
  if (f > 0 || f === 0 && 1 / f === safePositiveInfinity$2)
    return indexInFloatFromDecomp(exponent, significand);
  else
    return -indexInFloatFromDecomp(exponent, -significand) - 1;
}
function indexToFloat(index2) {
  if (index2 < 0)
    return -indexToFloat(-index2 - 1);
  if (index2 === INDEX_POSITIVE_INFINITY)
    return safePositiveInfinity$2;
  if (index2 < 16777216)
    return index2 * 2 ** -149;
  const postIndex = index2 - 16777216;
  const exponent = -125 + (postIndex >> 23);
  return (1 + (postIndex & 8388607) / 8388608) * 2 ** exponent;
}
var safeNegativeInfinity$1 = Number.NEGATIVE_INFINITY;
var safePositiveInfinity$1 = Number.POSITIVE_INFINITY;
var safeMaxValue = MAX_VALUE_32;
var maxNonIntegerValue = 8388607.5;
var onlyIntegersAfterThisValue = 8388608;
function refineConstraintsForFloatOnly(constraints) {
  return refineConstraintsForFloatingOnly(constraints, safeMaxValue, maxNonIntegerValue, onlyIntegersAfterThisValue);
}
function floatOnlyMapper(value3) {
  return value3 === 8388608 ? safePositiveInfinity$1 : value3 === -8388608 ? safeNegativeInfinity$1 : value3;
}
function floatOnlyUnmapper(value3) {
  if (typeof value3 !== "number")
    throw new Error("Unsupported type");
  return value3 === safePositiveInfinity$1 ? onlyIntegersAfterThisValue : value3 === safeNegativeInfinity$1 ? -onlyIntegersAfterThisValue : value3;
}
var safeNumberIsInteger = Number.isInteger;
var safeNumberIsNaN = Number.isNaN;
var safeMathFround = Math.fround;
var safeNegativeInfinity = Number.NEGATIVE_INFINITY;
var safePositiveInfinity = Number.POSITIVE_INFINITY;
var safeNaN = NaN;
function safeFloatToIndex(f, constraintsLabel) {
  const errorMessage = "fc.float constraints." + constraintsLabel + " must be a 32-bit float - you can convert any double to a 32-bit float by using `Math.fround(myDouble)`";
  if (safeNumberIsNaN(f) || safeMathFround(f) !== f)
    throw new Error(errorMessage);
  return floatToIndex(f);
}
function unmapperFloatToIndex(value3) {
  if (typeof value3 !== "number")
    throw new Error("Unsupported type");
  return floatToIndex(value3);
}
function numberIsNotInteger(value3) {
  return !safeNumberIsInteger(value3);
}
function anyFloat(constraints) {
  const { noDefaultInfinity = false, noNaN = false, minExcluded = false, maxExcluded = false, min: min4 = noDefaultInfinity ? -MAX_VALUE_32 : safeNegativeInfinity, max: max4 = noDefaultInfinity ? MAX_VALUE_32 : safePositiveInfinity } = constraints;
  const minIndexRaw = safeFloatToIndex(min4, "min");
  const minIndex = minExcluded ? minIndexRaw + 1 : minIndexRaw;
  const maxIndexRaw = safeFloatToIndex(max4, "max");
  const maxIndex = maxExcluded ? maxIndexRaw - 1 : maxIndexRaw;
  if (minIndex > maxIndex)
    throw new Error("fc.float constraints.min must be smaller or equal to constraints.max");
  if (noNaN)
    return integer({
      min: minIndex,
      max: maxIndex
    }).map(indexToFloat, unmapperFloatToIndex);
  const minIndexWithNaN = maxIndex > 0 ? minIndex : minIndex - 1;
  const maxIndexWithNaN = maxIndex > 0 ? maxIndex + 1 : maxIndex;
  return integer({
    min: minIndexWithNaN,
    max: maxIndexWithNaN
  }).map((index2) => {
    if (index2 > maxIndex || index2 < minIndex)
      return safeNaN;
    else
      return indexToFloat(index2);
  }, (value3) => {
    if (typeof value3 !== "number")
      throw new Error("Unsupported type");
    if (safeNumberIsNaN(value3))
      return maxIndex !== maxIndexWithNaN ? maxIndexWithNaN : minIndexWithNaN;
    return floatToIndex(value3);
  });
}
function float(constraints = {}) {
  if (!constraints.noInteger)
    return anyFloat(constraints);
  return anyFloat(refineConstraintsForFloatOnly(constraints)).map(floatOnlyMapper, floatOnlyUnmapper).filter(numberIsNotInteger);
}
function escapeForTemplateString(originalText) {
  return originalText.replace(/([$`\\])/g, "\\$1").replace(/\r/g, "\\r");
}
function escapeForMultilineComments(originalText) {
  return originalText.replace(/\*\//g, "*\\/");
}
var crc32Table = [
  0,
  1996959894,
  3993919788,
  2567524794,
  124634137,
  1886057615,
  3915621685,
  2657392035,
  249268274,
  2044508324,
  3772115230,
  2547177864,
  162941995,
  2125561021,
  3887607047,
  2428444049,
  498536548,
  1789927666,
  4089016648,
  2227061214,
  450548861,
  1843258603,
  4107580753,
  2211677639,
  325883990,
  1684777152,
  4251122042,
  2321926636,
  335633487,
  1661365465,
  4195302755,
  2366115317,
  997073096,
  1281953886,
  3579855332,
  2724688242,
  1006888145,
  1258607687,
  3524101629,
  2768942443,
  901097722,
  1119000684,
  3686517206,
  2898065728,
  853044451,
  1172266101,
  3705015759,
  2882616665,
  651767980,
  1373503546,
  3369554304,
  3218104598,
  565507253,
  1454621731,
  3485111705,
  3099436303,
  671266974,
  1594198024,
  3322730930,
  2970347812,
  795835527,
  1483230225,
  3244367275,
  3060149565,
  1994146192,
  31158534,
  2563907772,
  4023717930,
  1907459465,
  112637215,
  2680153253,
  3904427059,
  2013776290,
  251722036,
  2517215374,
  3775830040,
  2137656763,
  141376813,
  2439277719,
  3865271297,
  1802195444,
  476864866,
  2238001368,
  4066508878,
  1812370925,
  453092731,
  2181625025,
  4111451223,
  1706088902,
  314042704,
  2344532202,
  4240017532,
  1658658271,
  366619977,
  2362670323,
  4224994405,
  1303535960,
  984961486,
  2747007092,
  3569037538,
  1256170817,
  1037604311,
  2765210733,
  3554079995,
  1131014506,
  879679996,
  2909243462,
  3663771856,
  1141124467,
  855842277,
  2852801631,
  3708648649,
  1342533948,
  654459306,
  3188396048,
  3373015174,
  1466479909,
  544179635,
  3110523913,
  3462522015,
  1591671054,
  702138776,
  2966460450,
  3352799412,
  1504918807,
  783551873,
  3082640443,
  3233442989,
  3988292384,
  2596254646,
  62317068,
  1957810842,
  3939845945,
  2647816111,
  81470997,
  1943803523,
  3814918930,
  2489596804,
  225274430,
  2053790376,
  3826175755,
  2466906013,
  167816743,
  2097651377,
  4027552580,
  2265490386,
  503444072,
  1762050814,
  4150417245,
  2154129355,
  426522225,
  1852507879,
  4275313526,
  2312317920,
  282753626,
  1742555852,
  4189708143,
  2394877945,
  397917763,
  1622183637,
  3604390888,
  2714866558,
  953729732,
  1340076626,
  3518719985,
  2797360999,
  1068828381,
  1219638859,
  3624741850,
  2936675148,
  906185462,
  1090812512,
  3747672003,
  2825379669,
  829329135,
  1181335161,
  3412177804,
  3160834842,
  628085408,
  1382605366,
  3423369109,
  3138078467,
  570562233,
  1426400815,
  3317316542,
  2998733608,
  733239954,
  1555261956,
  3268935591,
  3050360625,
  752459403,
  1541320221,
  2607071920,
  3965973030,
  1969922972,
  40735498,
  2617837225,
  3943577151,
  1913087877,
  83908371,
  2512341634,
  3803740692,
  2075208622,
  213261112,
  2463272603,
  3855990285,
  2094854071,
  198958881,
  2262029012,
  4057260610,
  1759359992,
  534414190,
  2176718541,
  4139329115,
  1873836001,
  414664567,
  2282248934,
  4279200368,
  1711684554,
  285281116,
  2405801727,
  4167216745,
  1634467795,
  376229701,
  2685067896,
  3608007406,
  1308918612,
  956543938,
  2808555105,
  3495958263,
  1231636301,
  1047427035,
  2932959818,
  3654703836,
  1088359270,
  936918000,
  2847714899,
  3736837829,
  1202900863,
  817233897,
  3183342108,
  3401237130,
  1404277552,
  615818150,
  3134207493,
  3453421203,
  1423857449,
  601450431,
  3009837614,
  3294710456,
  1567103746,
  711928724,
  3020668471,
  3272380065,
  1510334235,
  755167117
];
function hash2(repr) {
  let crc = 4294967295;
  for (let idx = 0;idx < repr.length; ++idx) {
    const c = safeCharCodeAt(repr, idx);
    if (c < 128)
      crc = crc32Table[crc & 255 ^ c] ^ crc >> 8;
    else if (c < 2048) {
      crc = crc32Table[crc & 255 ^ (192 | c >> 6 & 31)] ^ crc >> 8;
      crc = crc32Table[crc & 255 ^ (128 | c & 63)] ^ crc >> 8;
    } else if (c >= 55296 && c < 57344) {
      const cNext = safeCharCodeAt(repr, ++idx);
      if (c >= 56320 || cNext < 56320 || cNext > 57343 || Number.isNaN(cNext)) {
        idx -= 1;
        crc = crc32Table[crc & 255 ^ 239] ^ crc >> 8;
        crc = crc32Table[crc & 255 ^ 191] ^ crc >> 8;
        crc = crc32Table[crc & 255 ^ 189] ^ crc >> 8;
      } else {
        const c1 = (c & 1023) + 64;
        const c2 = cNext & 1023;
        crc = crc32Table[crc & 255 ^ (240 | c1 >> 8 & 7)] ^ crc >> 8;
        crc = crc32Table[crc & 255 ^ (128 | c1 >> 2 & 63)] ^ crc >> 8;
        crc = crc32Table[crc & 255 ^ (128 | c2 >> 6 & 15 | (c1 & 3) << 4)] ^ crc >> 8;
        crc = crc32Table[crc & 255 ^ (128 | c2 & 63)] ^ crc >> 8;
      }
    } else {
      crc = crc32Table[crc & 255 ^ (224 | c >> 12 & 15)] ^ crc >> 8;
      crc = crc32Table[crc & 255 ^ (128 | c >> 6 & 63)] ^ crc >> 8;
      crc = crc32Table[crc & 255 ^ (128 | c & 63)] ^ crc >> 8;
    }
  }
  return (crc | 0) + 2147483648;
}
var stableObjectGetPrototypeOf = Object.getPrototypeOf;
var NoShrinkArbitrary = class extends Arbitrary {
  constructor(arb) {
    super();
    this.arb = arb;
  }
  generate(mrng, biasFactor) {
    return this.arb.generate(mrng, biasFactor);
  }
  canShrinkWithoutContext(value3) {
    return this.arb.canShrinkWithoutContext(value3);
  }
  shrink(_value, _context) {
    return Stream.nil();
  }
};
function noShrink(arb) {
  if (stableObjectGetPrototypeOf(arb) === NoShrinkArbitrary.prototype && arb.generate === NoShrinkArbitrary.prototype.generate && arb.canShrinkWithoutContext === NoShrinkArbitrary.prototype.canShrinkWithoutContext && arb.shrink === NoShrinkArbitrary.prototype.shrink)
    return arb;
  return new NoShrinkArbitrary(arb);
}
var safeObjectAssign$3 = Object.assign;
var safeObjectKeys$3 = Object.keys;
function buildCompareFunctionArbitrary(cmp) {
  return tuple2(noShrink(integer()), noShrink(integer({
    min: 1,
    max: 4294967295
  }))).map(([seed, hashEnvSize]) => {
    const producer = () => {
      const recorded = {};
      const f = (a, b) => {
        const reprA = stringify(a);
        const reprB = stringify(b);
        const val = cmp(hash2(`${seed}${reprA}`) % hashEnvSize, hash2(`${seed}${reprB}`) % hashEnvSize);
        recorded[`[${reprA},${reprB}]`] = val;
        return val;
      };
      return safeObjectAssign$3(f, {
        toString: () => {
          const seenValues = safeObjectKeys$3(recorded).sort().map((k) => `${k} => ${stringify(recorded[k])}`).map((line) => `/* ${escapeForMultilineComments(line)} */`);
          return `function(a, b) {
  // With hash and stringify coming from fast-check${seenValues.length !== 0 ? `
  ${safeJoin(seenValues, `
  `)}` : ""}
  const cmp = ${cmp};
  const hA = hash('${seed}' + stringify(a)) % ${hashEnvSize};
  const hB = hash('${seed}' + stringify(b)) % ${hashEnvSize};
  return cmp(hA, hB);
}`;
        },
        [cloneMethod]: producer
      });
    };
    return producer();
  });
}
var safeObjectAssign$2 = Object.assign;
function compareBooleanFunc() {
  return buildCompareFunctionArbitrary(safeObjectAssign$2((hA, hB) => hA < hB, { toString() {
    return "(hA, hB) => hA < hB";
  } }));
}
var safeObjectAssign$1 = Object.assign;
function compareFunc() {
  return buildCompareFunctionArbitrary(safeObjectAssign$1((hA, hB) => hA - hB, { toString() {
    return "(hA, hB) => hA - hB";
  } }));
}
var safeObjectDefineProperties$1 = Object.defineProperties;
var safeObjectKeys$2 = Object.keys;
function func(arb) {
  return tuple2(array3(arb, { minLength: 1 }), noShrink(integer())).map(([outs, seed]) => {
    const producer = () => {
      const recorded = {};
      const f = (...args2) => {
        const repr = stringify(args2);
        const val = outs[hash2(`${seed}${repr}`) % outs.length];
        recorded[repr] = val;
        return hasCloneMethod(val) ? val[cloneMethod]() : val;
      };
      function prettyPrint(stringifiedOuts) {
        const seenValues = safeMap(safeMap(safeSort(safeObjectKeys$2(recorded)), (k) => `${k} => ${stringify(recorded[k])}`), (line) => `/* ${escapeForMultilineComments(line)} */`);
        return `function(...args) {
  // With hash and stringify coming from fast-check${seenValues.length !== 0 ? `
  ${seenValues.join(`
  `)}` : ""}
  const outs = ${stringifiedOuts};
  return outs[hash('${seed}' + stringify(args)) % outs.length];
}`;
      }
      return safeObjectDefineProperties$1(f, {
        toString: { value: () => prettyPrint(stringify(outs)) },
        [toStringMethod]: { value: () => prettyPrint(stringify(outs)) },
        [asyncToStringMethod]: { value: async () => prettyPrint(await asyncStringify(outs)) },
        [cloneMethod]: {
          value: producer,
          configurable: true
        }
      });
    };
    return producer();
  });
}
var safeMinSafeInteger = Number.MIN_SAFE_INTEGER;
var safeMaxSafeInteger$1 = Number.MAX_SAFE_INTEGER;
function maxSafeInteger() {
  return new IntegerArbitrary(safeMinSafeInteger, safeMaxSafeInteger$1);
}
var safeMaxSafeInteger = Number.MAX_SAFE_INTEGER;
function maxSafeNat() {
  return new IntegerArbitrary(0, safeMaxSafeInteger);
}
var safeNumberParseInt = Number.parseInt;
function natToStringifiedNatMapper(options) {
  const [style, v] = options;
  switch (style) {
    case "oct":
      return `0${safeNumberToString(v, 8)}`;
    case "hex":
      return `0x${safeNumberToString(v, 16)}`;
    default:
      return `${v}`;
  }
}
function tryParseStringifiedNat(stringValue, radix) {
  const parsedNat = safeNumberParseInt(stringValue, radix);
  if (safeNumberToString(parsedNat, radix) !== stringValue)
    throw new Error("Invalid value");
  return parsedNat;
}
function natToStringifiedNatUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Invalid type");
  if (value3.length >= 2 && value3[0] === "0") {
    if (value3[1] === "x")
      return ["hex", tryParseStringifiedNat(safeSubstring(value3, 2), 16)];
    return ["oct", tryParseStringifiedNat(safeSubstring(value3, 1), 8)];
  }
  return ["dec", tryParseStringifiedNat(value3, 10)];
}
function dotJoinerMapper$1(data) {
  return safeJoin(data, ".");
}
function dotJoinerUnmapper$1(value3) {
  if (typeof value3 !== "string")
    throw new Error("Invalid type");
  return safeMap(safeSplit(value3, "."), (v) => tryParseStringifiedNat(v, 10));
}
function ipV4() {
  return tuple2(nat(255), nat(255), nat(255), nat(255)).map(dotJoinerMapper$1, dotJoinerUnmapper$1);
}
function buildStringifiedNatArbitrary(maxValue) {
  return tuple2(constantFrom("dec", "oct", "hex"), nat(maxValue)).map(natToStringifiedNatMapper, natToStringifiedNatUnmapper);
}
function dotJoinerMapper(data) {
  return safeJoin(data, ".");
}
function dotJoinerUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Invalid type");
  return safeSplit(value3, ".");
}
function ipV4Extended() {
  return oneof(tuple2(buildStringifiedNatArbitrary(255), buildStringifiedNatArbitrary(255), buildStringifiedNatArbitrary(255), buildStringifiedNatArbitrary(255)).map(dotJoinerMapper, dotJoinerUnmapper), tuple2(buildStringifiedNatArbitrary(255), buildStringifiedNatArbitrary(255), buildStringifiedNatArbitrary(65535)).map(dotJoinerMapper, dotJoinerUnmapper), tuple2(buildStringifiedNatArbitrary(255), buildStringifiedNatArbitrary(16777215)).map(dotJoinerMapper, dotJoinerUnmapper), buildStringifiedNatArbitrary(4294967295));
}
function readBh(value3) {
  if (value3.length === 0)
    return [];
  else
    return safeSplit(value3, ":");
}
function extractEhAndL(value3) {
  const valueSplits = safeSplit(value3, ":");
  if (valueSplits.length >= 2 && valueSplits[valueSplits.length - 1].length <= 4)
    return [safeSlice(valueSplits, 0, valueSplits.length - 2), `${valueSplits[valueSplits.length - 2]}:${valueSplits[valueSplits.length - 1]}`];
  return [safeSlice(valueSplits, 0, valueSplits.length - 1), valueSplits[valueSplits.length - 1]];
}
function fullySpecifiedMapper(data) {
  return `${safeJoin(data[0], ":")}:${data[1]}`;
}
function fullySpecifiedUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Invalid type");
  return extractEhAndL(value3);
}
function onlyTrailingMapper(data) {
  return `::${safeJoin(data[0], ":")}:${data[1]}`;
}
function onlyTrailingUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Invalid type");
  if (!safeStartsWith(value3, "::"))
    throw new Error("Invalid value");
  return extractEhAndL(safeSubstring(value3, 2));
}
function multiTrailingMapper(data) {
  return `${safeJoin(data[0], ":")}::${safeJoin(data[1], ":")}:${data[2]}`;
}
function multiTrailingUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Invalid type");
  const [bhString, trailingString] = safeSplit(value3, "::", 2);
  const [eh, l] = extractEhAndL(trailingString);
  return [
    readBh(bhString),
    eh,
    l
  ];
}
function multiTrailingMapperOne(data) {
  return multiTrailingMapper([
    data[0],
    [data[1]],
    data[2]
  ]);
}
function multiTrailingUnmapperOne(value3) {
  const out = multiTrailingUnmapper(value3);
  return [
    out[0],
    safeJoin(out[1], ":"),
    out[2]
  ];
}
function singleTrailingMapper(data) {
  return `${safeJoin(data[0], ":")}::${data[1]}`;
}
function singleTrailingUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Invalid type");
  const [bhString, trailing] = safeSplit(value3, "::", 2);
  return [readBh(bhString), trailing];
}
function noTrailingMapper(data) {
  return `${safeJoin(data[0], ":")}::`;
}
function noTrailingUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Invalid type");
  if (!safeEndsWith(value3, "::"))
    throw new Error("Invalid value");
  return [readBh(safeSubstring(value3, 0, value3.length - 2))];
}
function h16sTol32Mapper([a, b]) {
  return `${a}:${b}`;
}
function h16sTol32Unmapper(value3) {
  if (typeof value3 !== "string")
    throw new SError("Invalid type");
  if (!value3.includes(":"))
    throw new SError("Invalid value");
  return value3.split(":", 2);
}
var items = "0123456789abcdef";
var cachedHexa = undefined;
function hexa() {
  if (cachedHexa === undefined)
    cachedHexa = integer({
      min: 0,
      max: 15
    }).map((n) => items[n], (c) => {
      if (typeof c !== "string")
        throw new SError("Not a string");
      if (c.length !== 1)
        throw new SError("Invalid length");
      const code = safeCharCodeAt(c, 0);
      if (code <= 57)
        return code - 48;
      if (code < 97)
        throw new SError("Invalid character");
      return code - 87;
    });
  return cachedHexa;
}
function ipV6() {
  const h16Arb = string3({
    unit: hexa(),
    minLength: 1,
    maxLength: 4,
    size: "max"
  });
  const ls32Arb = oneof(tuple2(h16Arb, h16Arb).map(h16sTol32Mapper, h16sTol32Unmapper), ipV4());
  return oneof(tuple2(array3(h16Arb, {
    minLength: 6,
    maxLength: 6,
    size: "max"
  }), ls32Arb).map(fullySpecifiedMapper, fullySpecifiedUnmapper), tuple2(array3(h16Arb, {
    minLength: 5,
    maxLength: 5,
    size: "max"
  }), ls32Arb).map(onlyTrailingMapper, onlyTrailingUnmapper), tuple2(array3(h16Arb, {
    minLength: 0,
    maxLength: 1,
    size: "max"
  }), array3(h16Arb, {
    minLength: 4,
    maxLength: 4,
    size: "max"
  }), ls32Arb).map(multiTrailingMapper, multiTrailingUnmapper), tuple2(array3(h16Arb, {
    minLength: 0,
    maxLength: 2,
    size: "max"
  }), array3(h16Arb, {
    minLength: 3,
    maxLength: 3,
    size: "max"
  }), ls32Arb).map(multiTrailingMapper, multiTrailingUnmapper), tuple2(array3(h16Arb, {
    minLength: 0,
    maxLength: 3,
    size: "max"
  }), array3(h16Arb, {
    minLength: 2,
    maxLength: 2,
    size: "max"
  }), ls32Arb).map(multiTrailingMapper, multiTrailingUnmapper), tuple2(array3(h16Arb, {
    minLength: 0,
    maxLength: 4,
    size: "max"
  }), h16Arb, ls32Arb).map(multiTrailingMapperOne, multiTrailingUnmapperOne), tuple2(array3(h16Arb, {
    minLength: 0,
    maxLength: 5,
    size: "max"
  }), ls32Arb).map(singleTrailingMapper, singleTrailingUnmapper), tuple2(array3(h16Arb, {
    minLength: 0,
    maxLength: 6,
    size: "max"
  }), h16Arb).map(singleTrailingMapper, singleTrailingUnmapper), tuple2(array3(h16Arb, {
    minLength: 0,
    maxLength: 7,
    size: "max"
  })).map(noTrailingMapper, noTrailingUnmapper));
}
var LazyArbitrary = class extends Arbitrary {
  constructor(name) {
    super();
    this.name = name;
    this.underlying = null;
  }
  generate(mrng, biasFactor) {
    if (this.underlying === null)
      throw new Error(`Lazy arbitrary ${JSON.stringify(this.name)} not correctly initialized`);
    return this.underlying.generate(mrng, biasFactor);
  }
  canShrinkWithoutContext(value3) {
    if (this.underlying === null)
      throw new Error(`Lazy arbitrary ${JSON.stringify(this.name)} not correctly initialized`);
    return this.underlying.canShrinkWithoutContext(value3);
  }
  shrink(value3, context3) {
    if (this.underlying === null)
      throw new Error(`Lazy arbitrary ${JSON.stringify(this.name)} not correctly initialized`);
    return this.underlying.shrink(value3, context3);
  }
};
var safeGetOwnPropertyNames = Object.getOwnPropertyNames;
function createLazyArbsPool() {
  const lazyArbsPool = new SMap$1;
  const getLazyFromPool = (key) => {
    let lazyArb = safeMapGet(lazyArbsPool, key);
    if (lazyArb !== undefined)
      return lazyArb;
    lazyArb = new LazyArbitrary(String(key));
    safeMapSet(lazyArbsPool, key, lazyArb);
    return lazyArb;
  };
  return getLazyFromPool;
}
function letrec(builder) {
  const getLazyFromPool = createLazyArbsPool();
  const strictArbs = builder(getLazyFromPool);
  const declaredArbitraryNames = safeGetOwnPropertyNames(strictArbs);
  for (const name of declaredArbitraryNames) {
    const lazyArb = getLazyFromPool(name);
    lazyArb.underlying = strictArbs[name];
  }
  return strictArbs;
}
function canHaveAtLeastOneItem(keys3, constraints) {
  for (const key of keys3) {
    const constraintsOnKey = constraints[key] || {};
    if (constraintsOnKey.maxLength === undefined || constraintsOnKey.maxLength > 0)
      return true;
  }
  return false;
}
function initialPoolForEntityGraph(keys3, constraints) {
  if (keys3.length === 0)
    return constant2([]);
  if (!canHaveAtLeastOneItem(keys3, constraints))
    throw new SError("Contraints on pool must accept at least one entity, maxLength cannot sum to 0");
  return tuple2(...keys3.map((key) => array3(constant2(key), constraints[key]))).map((values2) => safeFlat(values2)).filter((names) => names.length > 0);
}
var safeObjectAssign = Object.assign;
var safeObjectCreate$4 = Object.create;
var safeObjectDefineProperty$1 = Object.defineProperty;
var safeObjectGetPrototypeOf = Object.getPrototypeOf;
var safeObjectPrototype = Object.prototype;
function withTargetStringifiedValue(stringifiedValue) {
  return safeObjectDefineProperty$1(safeObjectCreate$4(null), toStringMethod, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: () => stringifiedValue
  });
}
function withReferenceStringifiedValue(type, index2) {
  return withTargetStringifiedValue(`<${SString(type)}#${index2}>`);
}
function unlinkedToLinkedEntitiesMapper(unlinkedEntities, producedLinks) {
  const linkedEntities = safeObjectCreate$4(safeObjectPrototype);
  for (const name in unlinkedEntities) {
    const unlinkedEntitiesForName = unlinkedEntities[name];
    const linkedEntitiesForName = [];
    for (const unlinkedEntity of unlinkedEntitiesForName) {
      const linkedEntity = safeObjectAssign(safeObjectCreate$4(safeObjectGetPrototypeOf(unlinkedEntity)), unlinkedEntity);
      linkedEntitiesForName.push(linkedEntity);
    }
    linkedEntities[name] = linkedEntitiesForName;
  }
  for (const name in producedLinks) {
    const entityLinks = producedLinks[name];
    for (let entityIndex = 0;entityIndex !== entityLinks.length; ++entityIndex) {
      const entityLinksForInstance = entityLinks[entityIndex];
      const linkedInstance = linkedEntities[name][entityIndex];
      for (const prop in entityLinksForInstance) {
        const propValue = entityLinksForInstance[prop];
        linkedInstance[prop] = propValue.index === undefined ? undefined : typeof propValue.index === "number" ? linkedEntities[propValue.type][propValue.index] : safeMap(propValue.index, (index2) => linkedEntities[propValue.type][index2]);
      }
      safeObjectDefineProperty$1(linkedInstance, toStringMethod, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: () => {
          const unlinkedEntity = unlinkedEntities[name][entityIndex];
          const entity = safeObjectAssign(safeObjectCreate$4(safeObjectGetPrototypeOf(unlinkedEntity)), unlinkedEntity);
          for (const prop in entityLinksForInstance) {
            const propValue = entityLinksForInstance[prop];
            entity[prop] = propValue.index === undefined ? undefined : typeof propValue.index === "number" ? withReferenceStringifiedValue(propValue.type, propValue.index) : safeMap(propValue.index, (index2) => withReferenceStringifiedValue(propValue.type, index2));
          }
          return stringify(entity);
        }
      });
    }
  }
  return linkedEntities;
}
function buildInversedRelationsMapping(relations) {
  let foundInversedRelations = 0;
  const requestedInversedRelations = new SMap$1;
  for (const name in relations) {
    const relationsForName = relations[name];
    for (const fieldName in relationsForName) {
      const relation = relationsForName[fieldName];
      if (relation.arity !== "inverse")
        continue;
      let existingOnes = safeMapGet(requestedInversedRelations, relation.type);
      if (existingOnes === undefined) {
        existingOnes = new SMap$1;
        safeMapSet(requestedInversedRelations, relation.type, existingOnes);
      }
      if (safeMapHas(existingOnes, relation.forwardRelationship))
        throw new SError(`Cannot declare multiple inverse relationships for the same forward relationship ${SString(relation.forwardRelationship)} on type ${SString(relation.type)}`);
      safeMapSet(existingOnes, relation.forwardRelationship, {
        type: name,
        property: fieldName
      });
      foundInversedRelations += 1;
    }
  }
  const inversedRelations = new SMap$1;
  if (foundInversedRelations === 0)
    return inversedRelations;
  for (const name in relations) {
    const relationsForName = relations[name];
    const requestedInversedRelationsForName = safeMapGet(requestedInversedRelations, name);
    if (requestedInversedRelationsForName === undefined)
      continue;
    for (const fieldName in relationsForName) {
      const relation = relationsForName[fieldName];
      if (relation.arity === "inverse")
        continue;
      const requestedIfAny = safeMapGet(requestedInversedRelationsForName, fieldName);
      if (requestedIfAny === undefined)
        continue;
      if (requestedIfAny.type !== relation.type)
        throw new SError(`Inverse relationship ${SString(requestedIfAny.property)} on type ${SString(requestedIfAny.type)} references forward relationship ${SString(fieldName)} but types do not match`);
      safeMapSet(inversedRelations, relation, requestedIfAny);
    }
  }
  if (inversedRelations.size !== foundInversedRelations)
    throw new SError(`Some inverse relationships could not be matched with their corresponding forward relationships`);
  return inversedRelations;
}
var safeObjectCreate$3 = Object.create;
function produceLinkUnitaryIndexArbitrary(strategy, currentIndexIfSameType, countInTargetType) {
  switch (strategy) {
    case "exclusive":
      return constant2(countInTargetType);
    case "successor":
      return noBias(integer({
        min: currentIndexIfSameType !== undefined ? currentIndexIfSameType + 1 : 0,
        max: countInTargetType
      }));
    case "any":
      return noBias(integer({
        min: 0,
        max: countInTargetType
      }));
  }
}
function computeLinkIndex(arity, strategy, currentIndexIfSameType, countInTargetType, currentEntityDepth, mrng, biasFactor) {
  const linkArbitrary = produceLinkUnitaryIndexArbitrary(strategy, currentIndexIfSameType, countInTargetType);
  switch (arity) {
    case "0-1":
      return option2(linkArbitrary, {
        nil: undefined,
        depthIdentifier: currentEntityDepth
      }).generate(mrng, biasFactor).value;
    case "1":
      return linkArbitrary.generate(mrng, biasFactor).value;
    case "many": {
      let randomUnicity = 0;
      const values2 = option2(uniqueArray(linkArbitrary, {
        depthIdentifier: currentEntityDepth,
        selector: (v) => v === countInTargetType ? v + ++randomUnicity : v,
        minLength: 1
      }), {
        nil: [],
        depthIdentifier: currentEntityDepth
      }).generate(mrng, biasFactor).value;
      let offset = 0;
      return safeMap(values2, (v) => v === countInTargetType ? v + offset++ : v);
    }
  }
}
var OnTheFlyLinksForEntityGraphArbitrary = class extends Arbitrary {
  constructor(relations, defaultEntities) {
    super();
    this.relations = relations;
    this.defaultEntities = defaultEntities;
    const nonExclusiveEntities = new SSet;
    const exclusiveEntities = new SSet;
    for (const name in relations) {
      const relationsForName = relations[name];
      for (const fieldName in relationsForName) {
        const relation = relationsForName[fieldName];
        if (relation.arity === "inverse")
          continue;
        if (relation.strategy === "exclusive") {
          if (safeHas(nonExclusiveEntities, relation.type))
            throw new SError(`Cannot mix exclusive with other strategies for type ${SString(relation.type)}`);
          safeAdd(exclusiveEntities, relation.type);
        } else {
          if (safeHas(exclusiveEntities, relation.type))
            throw new SError(`Cannot mix exclusive with other strategies for type ${SString(relation.type)}`);
          safeAdd(nonExclusiveEntities, relation.type);
        }
        if (relation.strategy === "successor" && relation.type !== name)
          throw new SError(`Cannot mix types for the strategy successor`);
        if (relation.strategy === "successor" && relation.arity === "1")
          throw new SError(`Cannot use an arity of 1 for the strategy successor`);
      }
    }
    this.inversedRelations = buildInversedRelationsMapping(relations);
  }
  createEmptyLinksInstanceFor(targetType) {
    const emptyLinksInstance = safeObjectCreate$3(null);
    const relationsForType = this.relations[targetType];
    for (const name in relationsForType) {
      const relation = relationsForType[name];
      if (relation.arity === "inverse")
        emptyLinksInstance[name] = {
          type: relation.type,
          index: []
        };
    }
    return emptyLinksInstance;
  }
  generate(mrng, biasFactor) {
    const producedLinks = safeObjectCreate$3(null);
    for (const name in this.relations)
      producedLinks[name] = [];
    const toBeProducedEntities = [];
    for (const name of this.defaultEntities) {
      safePush(toBeProducedEntities, {
        type: name,
        indexInType: producedLinks[name].length,
        depth: 0
      });
      safePush(producedLinks[name], this.createEmptyLinksInstanceFor(name));
    }
    let lastTreatedEntities = -1;
    while (++lastTreatedEntities < toBeProducedEntities.length) {
      const currentEntity = toBeProducedEntities[lastTreatedEntities];
      const currentRelations = this.relations[currentEntity.type];
      const currentLinks = producedLinks[currentEntity.type][currentEntity.indexInType];
      const currentEntityDepth = createDepthIdentifier();
      currentEntityDepth.depth = currentEntity.depth;
      for (const name in currentRelations) {
        const relation = currentRelations[name];
        if (relation.arity === "inverse")
          continue;
        const targetType = relation.type;
        const producedLinksInTargetType = producedLinks[targetType];
        const countInTargetType = producedLinksInTargetType.length;
        const linkOrLinks = computeLinkIndex(relation.arity, relation.strategy || "any", targetType === currentEntity.type ? currentEntity.indexInType : undefined, producedLinksInTargetType.length, currentEntityDepth, mrng, biasFactor);
        currentLinks[name] = {
          type: targetType,
          index: linkOrLinks
        };
        const links = linkOrLinks === undefined ? [] : typeof linkOrLinks === "number" ? [linkOrLinks] : linkOrLinks;
        for (const link of links) {
          if (link >= countInTargetType) {
            safePush(toBeProducedEntities, {
              type: targetType,
              indexInType: link,
              depth: currentEntity.depth + 1
            });
            safePush(producedLinksInTargetType, this.createEmptyLinksInstanceFor(targetType));
          }
          const inversed = safeMapGet(this.inversedRelations, relation);
          if (inversed !== undefined) {
            const knownInversedLinks = producedLinksInTargetType[link][inversed.property].index;
            safePush(knownInversedLinks, currentEntity.indexInType);
          }
        }
      }
    }
    toBeProducedEntities.length = 0;
    return new Value(producedLinks, undefined);
  }
  canShrinkWithoutContext(_value) {
    return false;
  }
  shrink(_value, _context) {
    return Stream.nil();
  }
};
function onTheFlyLinksForEntityGraph(relations, defaultEntities) {
  return new OnTheFlyLinksForEntityGraphArbitrary(relations, defaultEntities);
}
var safeObjectKeys$1 = Object.keys;
var safeObjectGetOwnPropertySymbols$1 = Object.getOwnPropertySymbols;
var safeObjectGetOwnPropertyDescriptor$1 = Object.getOwnPropertyDescriptor;
function extractEnumerableKeys(instance) {
  const keys3 = safeObjectKeys$1(instance);
  const symbols = safeObjectGetOwnPropertySymbols$1(instance);
  for (let index2 = 0;index2 !== symbols.length; ++index2) {
    const symbol4 = symbols[index2];
    const descriptor = safeObjectGetOwnPropertyDescriptor$1(instance, symbol4);
    if (descriptor && descriptor.enumerable)
      keys3.push(symbol4);
  }
  return keys3;
}
var safeObjectCreate$2 = Object.create;
var safeObjectDefineProperty = Object.defineProperty;
var safeObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
var safeObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
var safeObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
function buildValuesAndSeparateKeysToObjectMapper(keys3, noKeyValue) {
  return function valuesAndSeparateKeysToObjectMapper(definition) {
    const obj = definition[1] ? safeObjectCreate$2(null) : {};
    for (let idx = 0;idx !== keys3.length; ++idx) {
      const valueWrapper = definition[0][idx];
      if (valueWrapper !== noKeyValue)
        safeObjectDefineProperty(obj, keys3[idx], {
          value: valueWrapper,
          configurable: true,
          enumerable: true,
          writable: true
        });
    }
    return obj;
  };
}
function buildValuesAndSeparateKeysToObjectUnmapper(keys3, noKeyValue) {
  return function valuesAndSeparateKeysToObjectUnmapper(value3) {
    if (typeof value3 !== "object" || value3 === null)
      throw new Error("Incompatible instance received: should be a non-null object");
    const hasNullPrototype = Object.getPrototypeOf(value3) === null;
    const hasObjectPrototype = "constructor" in value3 && value3.constructor === Object;
    if (!hasNullPrototype && !hasObjectPrototype)
      throw new Error("Incompatible instance received: should be of exact type Object");
    let extractedPropertiesCount = 0;
    const extractedValues = [];
    for (let idx = 0;idx !== keys3.length; ++idx) {
      const descriptor = safeObjectGetOwnPropertyDescriptor(value3, keys3[idx]);
      if (descriptor !== undefined) {
        if (!descriptor.configurable || !descriptor.enumerable || !descriptor.writable)
          throw new Error("Incompatible instance received: should contain only c/e/w properties");
        if (descriptor.get !== undefined || descriptor.set !== undefined)
          throw new Error("Incompatible instance received: should contain only no get/set properties");
        ++extractedPropertiesCount;
        safePush(extractedValues, descriptor.value);
      } else
        safePush(extractedValues, noKeyValue);
    }
    const namePropertiesCount = safeObjectGetOwnPropertyNames(value3).length;
    const symbolPropertiesCount = safeObjectGetOwnPropertySymbols(value3).length;
    if (extractedPropertiesCount !== namePropertiesCount + symbolPropertiesCount)
      throw new Error("Incompatible instance received: should not contain extra properties");
    return [extractedValues, hasNullPrototype];
  };
}
var noKeyValue = Symbol("no-key");
function buildPartialRecordArbitrary(recordModel, requiredKeys, noNullPrototype) {
  const keys3 = extractEnumerableKeys(recordModel);
  const arbs = [];
  for (let index2 = 0;index2 !== keys3.length; ++index2) {
    const k = keys3[index2];
    const requiredArbitrary = recordModel[k];
    if (requiredKeys === undefined || safeIndexOf(requiredKeys, k) !== -1)
      safePush(arbs, requiredArbitrary);
    else
      safePush(arbs, option2(requiredArbitrary, { nil: noKeyValue }));
  }
  return tuple2(tuple2(...arbs), noNullPrototype ? constant2(false) : boolean2()).map(buildValuesAndSeparateKeysToObjectMapper(keys3, noKeyValue), buildValuesAndSeparateKeysToObjectUnmapper(keys3, noKeyValue));
}
function record2(recordModel, constraints) {
  const noNullPrototype = constraints !== undefined && !!constraints.noNullPrototype;
  if (constraints === undefined)
    return buildPartialRecordArbitrary(recordModel, undefined, noNullPrototype);
  if (!(("requiredKeys" in constraints) && constraints.requiredKeys !== undefined))
    return buildPartialRecordArbitrary(recordModel, undefined, noNullPrototype);
  const requiredKeys = ("requiredKeys" in constraints ? constraints.requiredKeys : undefined) || [];
  for (let idx = 0;idx !== requiredKeys.length; ++idx) {
    const descriptor = Object.getOwnPropertyDescriptor(recordModel, requiredKeys[idx]);
    if (descriptor === undefined)
      throw new Error(`requiredKeys cannot reference keys that have not been defined in recordModel`);
    if (!descriptor.enumerable)
      throw new Error(`requiredKeys cannot reference keys that are not enumerable in recordModel`);
  }
  return buildPartialRecordArbitrary(recordModel, requiredKeys, noNullPrototype);
}
var safeObjectCreate$1 = Object.create;
function unlinkedEntitiesForEntityGraph(arbitraries, countFor, unicityConstraintsFor, constraints) {
  const recordModel = safeObjectCreate$1(null);
  for (const name in arbitraries) {
    const entityRecordModel = arbitraries[name];
    const entityArbitrary = record2(entityRecordModel, constraints);
    const count = countFor(name);
    const unicityConstraints = unicityConstraintsFor(name);
    const arrayConstraints = {
      minLength: count,
      maxLength: count
    };
    recordModel[name] = unicityConstraints !== undefined ? uniqueArray(entityArbitrary, {
      ...arrayConstraints,
      selector: unicityConstraints
    }) : array3(entityArbitrary, arrayConstraints);
  }
  return record2(recordModel);
}
var safeObjectCreate = Object.create;
var safeObjectKeys = Object.keys;
function entityGraph(arbitraries, relations, constraints = {}) {
  const allKeys = safeObjectKeys(arbitraries);
  const initialPoolConstraints = constraints.initialPoolConstraints || safeObjectCreate(null);
  const unicityConstraints = constraints.unicityConstraints || safeObjectCreate(null);
  const unlinkedContraints = { noNullPrototype: constraints.noNullPrototype };
  return initialPoolForEntityGraph(allKeys, initialPoolConstraints).chain((defaultEntities) => onTheFlyLinksForEntityGraph(relations, defaultEntities).chain((producedLinks) => unlinkedEntitiesForEntityGraph(arbitraries, (name) => producedLinks[name].length, (name) => unicityConstraints[name], unlinkedContraints).map((unlinkedEntities) => unlinkedToLinkedEntitiesMapper(unlinkedEntities, producedLinks))));
}
function wordsToJoinedStringMapper(words) {
  return safeJoin(safeMap(words, (w) => w[w.length - 1] === "," ? safeSubstring(w, 0, w.length - 1) : w), " ");
}
function wordsToJoinedStringUnmapperFor(wordsArbitrary) {
  return function wordsToJoinedStringUnmapper(value3) {
    if (typeof value3 !== "string")
      throw new Error("Unsupported type");
    const words = [];
    for (const candidate of safeSplit(value3, " "))
      if (wordsArbitrary.canShrinkWithoutContext(candidate))
        safePush(words, candidate);
      else if (wordsArbitrary.canShrinkWithoutContext(candidate + ","))
        safePush(words, candidate + ",");
      else
        throw new Error("Unsupported word");
    return words;
  };
}
function wordsToSentenceMapper(words) {
  let sentence = safeJoin(words, " ");
  if (sentence[sentence.length - 1] === ",")
    sentence = safeSubstring(sentence, 0, sentence.length - 1);
  return safeToUpperCase(sentence[0]) + safeSubstring(sentence, 1) + ".";
}
function wordsToSentenceUnmapperFor(wordsArbitrary) {
  return function wordsToSentenceUnmapper(value3) {
    if (typeof value3 !== "string")
      throw new Error("Unsupported type");
    if (value3.length < 2 || value3[value3.length - 1] !== "." || value3[value3.length - 2] === "," || safeToUpperCase(safeToLowerCase(value3[0])) !== value3[0])
      throw new Error("Unsupported value");
    const adaptedValue = safeToLowerCase(value3[0]) + safeSubstring(value3, 1, value3.length - 1);
    const words = [];
    const candidates = safeSplit(adaptedValue, " ");
    for (let idx = 0;idx !== candidates.length; ++idx) {
      const candidate = candidates[idx];
      if (wordsArbitrary.canShrinkWithoutContext(candidate))
        safePush(words, candidate);
      else if (idx === candidates.length - 1 && wordsArbitrary.canShrinkWithoutContext(candidate + ","))
        safePush(words, candidate + ",");
      else
        throw new Error("Unsupported word");
    }
    return words;
  };
}
function sentencesToParagraphMapper(sentences) {
  return safeJoin(sentences, " ");
}
function sentencesToParagraphUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Unsupported type");
  const sentences = safeSplit(value3, ". ");
  for (let idx = 0;idx < sentences.length - 1; ++idx)
    sentences[idx] += ".";
  return sentences;
}
var h = (v, w) => {
  return {
    arbitrary: constant2(v),
    weight: w
  };
};
function loremWord() {
  return oneof(h("non", 6), h("adipiscing", 5), h("ligula", 5), h("enim", 5), h("pellentesque", 5), h("in", 5), h("augue", 5), h("et", 5), h("nulla", 5), h("lorem", 4), h("sit", 4), h("sed", 4), h("diam", 4), h("fermentum", 4), h("ut", 4), h("eu", 4), h("aliquam", 4), h("mauris", 4), h("vitae", 4), h("felis", 4), h("ipsum", 3), h("dolor", 3), h("amet,", 3), h("elit", 3), h("euismod", 3), h("mi", 3), h("orci", 3), h("erat", 3), h("praesent", 3), h("egestas", 3), h("leo", 3), h("vel", 3), h("sapien", 3), h("integer", 3), h("curabitur", 3), h("convallis", 3), h("purus", 3), h("risus", 2), h("suspendisse", 2), h("lectus", 2), h("nec,", 2), h("ultricies", 2), h("sed,", 2), h("cras", 2), h("elementum", 2), h("ultrices", 2), h("maecenas", 2), h("massa,", 2), h("varius", 2), h("a,", 2), h("semper", 2), h("proin", 2), h("nec", 2), h("nisl", 2), h("amet", 2), h("duis", 2), h("congue", 2), h("libero", 2), h("vestibulum", 2), h("pede", 2), h("blandit", 2), h("sodales", 2), h("ante", 2), h("nibh", 2), h("ac", 2), h("aenean", 2), h("massa", 2), h("suscipit", 2), h("sollicitudin", 2), h("fusce", 2), h("tempus", 2), h("aliquam,", 2), h("nunc", 2), h("ullamcorper", 2), h("rhoncus", 2), h("metus", 2), h("faucibus,", 2), h("justo", 2), h("magna", 2), h("at", 2), h("tincidunt", 2), h("consectetur", 1), h("tortor,", 1), h("dignissim", 1), h("congue,", 1), h("non,", 1), h("porttitor,", 1), h("nonummy", 1), h("molestie,", 1), h("est", 1), h("eleifend", 1), h("mi,", 1), h("arcu", 1), h("scelerisque", 1), h("vitae,", 1), h("consequat", 1), h("in,", 1), h("pretium", 1), h("volutpat", 1), h("pharetra", 1), h("tempor", 1), h("bibendum", 1), h("odio", 1), h("dui", 1), h("primis", 1), h("faucibus", 1), h("luctus", 1), h("posuere", 1), h("cubilia", 1), h("curae,", 1), h("hendrerit", 1), h("velit", 1), h("mauris,", 1), h("gravida", 1), h("ornare", 1), h("ut,", 1), h("pulvinar", 1), h("varius,", 1), h("turpis", 1), h("nibh,", 1), h("eros", 1), h("id", 1), h("aliquet", 1), h("quis", 1), h("lobortis", 1), h("consectetuer", 1), h("morbi", 1), h("vehicula", 1), h("tortor", 1), h("tellus,", 1), h("id,", 1), h("eu,", 1), h("quam", 1), h("feugiat,", 1), h("posuere,", 1), h("iaculis", 1), h("lectus,", 1), h("tristique", 1), h("mollis,", 1), h("nisl,", 1), h("vulputate", 1), h("sem", 1), h("vivamus", 1), h("placerat", 1), h("imperdiet", 1), h("cursus", 1), h("rutrum", 1), h("iaculis,", 1), h("augue,", 1), h("lacus", 1));
}
function lorem(constraints = {}) {
  const { maxCount, mode = "words", size: size6 } = constraints;
  if (maxCount !== undefined && maxCount < 1)
    throw new Error(`lorem has to produce at least one word/sentence`);
  const wordArbitrary = loremWord();
  if (mode === "sentences")
    return array3(array3(wordArbitrary, {
      minLength: 1,
      size: "small"
    }).map(wordsToSentenceMapper, wordsToSentenceUnmapperFor(wordArbitrary)), {
      minLength: 1,
      maxLength: maxCount,
      size: size6
    }).map(sentencesToParagraphMapper, sentencesToParagraphUnmapper);
  else
    return array3(wordArbitrary, {
      minLength: 1,
      maxLength: maxCount,
      size: size6
    }).map(wordsToJoinedStringMapper, wordsToJoinedStringUnmapperFor(wordArbitrary));
}
function arrayToMapMapper(data) {
  return new Map(data);
}
function arrayToMapUnmapper(value3) {
  if (typeof value3 !== "object" || value3 === null)
    throw new Error("Incompatible instance received: should be a non-null object");
  if (!("constructor" in value3) || value3.constructor !== Map)
    throw new Error("Incompatible instance received: should be of exact type Map");
  return Array.from(value3);
}
function mapKeyExtractor(entry) {
  return entry[0];
}
function map10(keyArb, valueArb, constraints = {}) {
  return uniqueArray(tuple2(keyArb, valueArb), {
    minLength: constraints.minKeys,
    maxLength: constraints.maxKeys,
    size: constraints.size,
    selector: mapKeyExtractor,
    depthIdentifier: constraints.depthIdentifier,
    comparator: "SameValueZero"
  }).map(arrayToMapMapper, arrayToMapUnmapper);
}
var contextRemainingDepth = 10;
function memo(builder) {
  const previous = {};
  return (maxDepth) => {
    const n = maxDepth !== undefined ? maxDepth : contextRemainingDepth;
    if (!safeHasOwnProperty(previous, n)) {
      const prev = contextRemainingDepth;
      contextRemainingDepth = n - 1;
      previous[n] = builder(n);
      contextRemainingDepth = prev;
    }
    return previous[n];
  };
}
function countToggledBits(n) {
  let count = 0;
  while (n > SBigInt2(0)) {
    if (n & SBigInt2(1))
      ++count;
    n >>= SBigInt2(1);
  }
  return count;
}
function computeNextFlags(flags, nextSize) {
  const allowedMask = (SBigInt2(1) << SBigInt2(nextSize)) - SBigInt2(1);
  const preservedFlags = flags & allowedMask;
  let numMissingFlags = countToggledBits(flags - preservedFlags);
  let nFlags = preservedFlags;
  for (let mask2 = SBigInt2(1);mask2 <= allowedMask && numMissingFlags !== 0; mask2 <<= SBigInt2(1))
    if (!(nFlags & mask2)) {
      nFlags |= mask2;
      --numMissingFlags;
    }
  return nFlags;
}
function computeTogglePositions(chars, toggleCase) {
  const positions = [];
  for (let idx = chars.length - 1;idx !== -1; --idx)
    if (toggleCase(chars[idx]) !== chars[idx])
      safePush(positions, idx);
  return positions;
}
function computeFlagsFromChars(untoggledChars, toggledChars, togglePositions) {
  let flags = SBigInt2(0);
  for (let idx = 0, mask2 = SBigInt2(1);idx !== togglePositions.length; ++idx, mask2 <<= SBigInt2(1))
    if (untoggledChars[togglePositions[idx]] !== toggledChars[togglePositions[idx]])
      flags |= mask2;
  return flags;
}
function applyFlagsOnChars(chars, flags, togglePositions, toggleCase) {
  for (let idx = 0, mask2 = SBigInt2(1);idx !== togglePositions.length; ++idx, mask2 <<= SBigInt2(1))
    if (flags & mask2)
      chars[togglePositions[idx]] = toggleCase(chars[togglePositions[idx]]);
}
var MixedCaseArbitrary = class extends Arbitrary {
  constructor(stringArb, toggleCase, untoggleAll) {
    super();
    this.stringArb = stringArb;
    this.toggleCase = toggleCase;
    this.untoggleAll = untoggleAll;
  }
  buildContextFor(rawStringValue, flagsValue) {
    return {
      rawString: rawStringValue.value,
      rawStringContext: rawStringValue.context,
      flags: flagsValue.value,
      flagsContext: flagsValue.context
    };
  }
  generate(mrng, biasFactor) {
    const rawStringValue = this.stringArb.generate(mrng, biasFactor);
    const chars = [...rawStringValue.value];
    const togglePositions = computeTogglePositions(chars, this.toggleCase);
    const flagsValue = bigInt2(SBigInt2(0), (SBigInt2(1) << SBigInt2(togglePositions.length)) - SBigInt2(1)).generate(mrng, undefined);
    applyFlagsOnChars(chars, flagsValue.value, togglePositions, this.toggleCase);
    return new Value(safeJoin(chars, ""), this.buildContextFor(rawStringValue, flagsValue));
  }
  canShrinkWithoutContext(value3) {
    if (typeof value3 !== "string")
      return false;
    return this.untoggleAll !== undefined ? this.stringArb.canShrinkWithoutContext(this.untoggleAll(value3)) : this.stringArb.canShrinkWithoutContext(value3);
  }
  shrink(value3, context3) {
    let contextSafe;
    if (context3 !== undefined)
      contextSafe = context3;
    else if (this.untoggleAll !== undefined) {
      const untoggledValue = this.untoggleAll(value3);
      const valueChars = [...value3];
      const untoggledValueChars = [...untoggledValue];
      contextSafe = {
        rawString: untoggledValue,
        rawStringContext: undefined,
        flags: computeFlagsFromChars(untoggledValueChars, valueChars, computeTogglePositions(untoggledValueChars, this.toggleCase)),
        flagsContext: undefined
      };
    } else
      contextSafe = {
        rawString: value3,
        rawStringContext: undefined,
        flags: SBigInt2(0),
        flagsContext: undefined
      };
    const rawString = contextSafe.rawString;
    const flags = contextSafe.flags;
    return this.stringArb.shrink(rawString, contextSafe.rawStringContext).map((nRawStringValue) => {
      const nChars = [...nRawStringValue.value];
      const nTogglePositions = computeTogglePositions(nChars, this.toggleCase);
      const nFlags = computeNextFlags(flags, nTogglePositions.length);
      applyFlagsOnChars(nChars, nFlags, nTogglePositions, this.toggleCase);
      return new Value(safeJoin(nChars, ""), this.buildContextFor(nRawStringValue, new Value(nFlags, undefined)));
    }).join(makeLazy2(() => {
      const chars = [...rawString];
      const togglePositions = computeTogglePositions(chars, this.toggleCase);
      return bigInt2(SBigInt2(0), (SBigInt2(1) << SBigInt2(togglePositions.length)) - SBigInt2(1)).shrink(flags, contextSafe.flagsContext).map((nFlagsValue) => {
        const nChars = safeSlice(chars);
        applyFlagsOnChars(nChars, nFlagsValue.value, togglePositions, this.toggleCase);
        return new Value(safeJoin(nChars, ""), this.buildContextFor(new Value(rawString, contextSafe.rawStringContext), nFlagsValue));
      });
    }));
  }
};
function defaultToggleCase(rawChar) {
  const upper = safeToUpperCase(rawChar);
  if (upper !== rawChar)
    return upper;
  return safeToLowerCase(rawChar);
}
function mixedCase(stringArb, constraints) {
  return new MixedCaseArbitrary(stringArb, constraints && constraints.toggleCase || defaultToggleCase, constraints && constraints.untoggleAll);
}
function toTypedMapper$1(data) {
  return SFloat32Array.from(data);
}
function fromTypedUnmapper$1(value3) {
  if (!(value3 instanceof SFloat32Array))
    throw new Error("Unexpected type");
  return [...value3];
}
function float32Array(constraints = {}) {
  return array3(float(constraints), constraints).map(toTypedMapper$1, fromTypedUnmapper$1);
}
function toTypedMapper(data) {
  return SFloat64Array.from(data);
}
function fromTypedUnmapper(value3) {
  if (!(value3 instanceof SFloat64Array))
    throw new Error("Unexpected type");
  return [...value3];
}
function float64Array(constraints = {}) {
  return array3(double(constraints), constraints).map(toTypedMapper, fromTypedUnmapper);
}
function typedIntArrayArbitraryArbitraryBuilder(constraints, defaultMin, defaultMax, TypedArrayClass, arbitraryBuilder) {
  const generatorName = TypedArrayClass.name;
  const { min: min4 = defaultMin, max: max4 = defaultMax, ...arrayConstraints } = constraints;
  if (min4 > max4)
    throw new Error(`Invalid range passed to ${generatorName}: min must be lower than or equal to max`);
  if (min4 < defaultMin)
    throw new Error(`Invalid min value passed to ${generatorName}: min must be greater than or equal to ${defaultMin}`);
  if (max4 > defaultMax)
    throw new Error(`Invalid max value passed to ${generatorName}: max must be lower than or equal to ${defaultMax}`);
  return array3(arbitraryBuilder({
    min: min4,
    max: max4
  }), arrayConstraints).map((data) => TypedArrayClass.from(data), (value3) => {
    if (!(value3 instanceof TypedArrayClass))
      throw new Error("Invalid type");
    return [...value3];
  });
}
function int16Array(constraints = {}) {
  return typedIntArrayArbitraryArbitraryBuilder(constraints, -32768, 32767, SInt16Array, integer);
}
function int32Array(constraints = {}) {
  return typedIntArrayArbitraryArbitraryBuilder(constraints, -2147483648, 2147483647, SInt32Array, integer);
}
function int8Array(constraints = {}) {
  return typedIntArrayArbitraryArbitraryBuilder(constraints, -128, 127, SInt8Array, integer);
}
function uint16Array(constraints = {}) {
  return typedIntArrayArbitraryArbitraryBuilder(constraints, 0, 65535, SUint16Array, integer);
}
function uint32Array(constraints = {}) {
  return typedIntArrayArbitraryArbitraryBuilder(constraints, 0, 4294967295, SUint32Array, integer);
}
function uint8Array(constraints = {}) {
  return typedIntArrayArbitraryArbitraryBuilder(constraints, 0, 255, SUint8Array, integer);
}
function uint8ClampedArray(constraints = {}) {
  return typedIntArrayArbitraryArbitraryBuilder(constraints, 0, 255, SUint8ClampedArray, integer);
}
function isSafeContext(context3) {
  return context3 !== undefined;
}
function toGeneratorValue(value3) {
  if (value3.hasToBeCloned)
    return new Value(value3.value_, { generatorContext: value3.context }, () => value3.value);
  return new Value(value3.value_, { generatorContext: value3.context });
}
function toShrinkerValue(value3) {
  if (value3.hasToBeCloned)
    return new Value(value3.value_, { shrinkerContext: value3.context }, () => value3.value);
  return new Value(value3.value_, { shrinkerContext: value3.context });
}
var WithShrinkFromOtherArbitrary = class extends Arbitrary {
  constructor(generatorArbitrary, shrinkerArbitrary) {
    super();
    this.generatorArbitrary = generatorArbitrary;
    this.shrinkerArbitrary = shrinkerArbitrary;
  }
  generate(mrng, biasFactor) {
    return toGeneratorValue(this.generatorArbitrary.generate(mrng, biasFactor));
  }
  canShrinkWithoutContext(value3) {
    return this.shrinkerArbitrary.canShrinkWithoutContext(value3);
  }
  shrink(value3, context3) {
    if (!isSafeContext(context3))
      return this.shrinkerArbitrary.shrink(value3, undefined).map(toShrinkerValue);
    if ("generatorContext" in context3)
      return this.generatorArbitrary.shrink(value3, context3.generatorContext).map(toGeneratorValue);
    return this.shrinkerArbitrary.shrink(value3, context3.shrinkerContext).map(toShrinkerValue);
  }
};
function restrictedIntegerArbitraryBuilder(min4, maxGenerated, max4) {
  const generatorArbitrary = integer({
    min: min4,
    max: maxGenerated
  });
  if (maxGenerated === max4)
    return generatorArbitrary;
  return new WithShrinkFromOtherArbitrary(generatorArbitrary, integer({
    min: min4,
    max: max4
  }));
}
var safeMathMin$1 = Math.min;
var safeMathMax = Math.max;
var safeArrayIsArray$1 = SArray.isArray;
var safeObjectEntries = Object.entries;
function extractMaxIndex(indexesAndValues) {
  let maxIndex = -1;
  for (let index2 = 0;index2 !== indexesAndValues.length; ++index2)
    maxIndex = safeMathMax(maxIndex, indexesAndValues[index2][0]);
  return maxIndex;
}
function arrayFromItems(length, indexesAndValues) {
  const array4 = SArray(length);
  for (let index2 = 0;index2 !== indexesAndValues.length; ++index2) {
    const it = indexesAndValues[index2];
    if (it[0] < length)
      array4[it[0]] = it[1];
  }
  return array4;
}
function sparseArray(arb, constraints = {}) {
  const { size: size6, minNumElements = 0, maxLength = MaxLengthUpperBound, maxNumElements = maxLength, noTrailingHole, depthIdentifier } = constraints;
  const maxGeneratedLength = maxGeneratedLengthFromSizeForArbitrary(size6, maxGeneratedLengthFromSizeForArbitrary(size6, minNumElements, maxNumElements, constraints.maxNumElements !== undefined), maxLength, constraints.maxLength !== undefined);
  if (minNumElements > maxLength)
    throw new Error(`The minimal number of non-hole elements cannot be higher than the maximal length of the array`);
  if (minNumElements > maxNumElements)
    throw new Error(`The minimal number of non-hole elements cannot be higher than the maximal number of non-holes`);
  const resultedMaxNumElements = safeMathMin$1(maxNumElements, maxLength);
  const resultedSizeMaxNumElements = constraints.maxNumElements !== undefined || size6 !== undefined ? size6 : "=";
  const sparseArrayNoTrailingHole = uniqueArray(tuple2(restrictedIntegerArbitraryBuilder(0, safeMathMax(maxGeneratedLength - 1, 0), safeMathMax(maxLength - 1, 0)), arb), {
    size: resultedSizeMaxNumElements,
    minLength: minNumElements,
    maxLength: resultedMaxNumElements,
    selector: (item) => item[0],
    depthIdentifier
  }).map((items2) => {
    return arrayFromItems(extractMaxIndex(items2) + 1, items2);
  }, (value3) => {
    if (!safeArrayIsArray$1(value3))
      throw new Error("Not supported entry type");
    if (noTrailingHole && value3.length !== 0 && !(value3.length - 1 in value3))
      throw new Error("No trailing hole");
    return safeMap(safeObjectEntries(value3), (entry) => [Number(entry[0]), entry[1]]);
  });
  if (noTrailingHole || maxLength === minNumElements)
    return sparseArrayNoTrailingHole;
  return tuple2(sparseArrayNoTrailingHole, restrictedIntegerArbitraryBuilder(minNumElements, maxGeneratedLength, maxLength)).map((data) => {
    const sparse = data[0];
    const targetLength = data[1];
    if (sparse.length >= targetLength)
      return sparse;
    const longerSparse = safeSlice(sparse);
    longerSparse.length = targetLength;
    return longerSparse;
  }, (value3) => {
    if (!safeArrayIsArray$1(value3))
      throw new Error("Not supported entry type");
    return [value3, value3.length];
  });
}
function arrayToSetMapper(data) {
  return new Set(data);
}
function arrayToSetUnmapper(value3) {
  if (typeof value3 !== "object" || value3 === null)
    throw new Error("Incompatible instance received: should be a non-null object");
  if (!("constructor" in value3) || value3.constructor !== Set)
    throw new Error("Incompatible instance received: should be of exact type Set");
  return Array.from(value3);
}
function set3(arb, constraints = {}) {
  return uniqueArray(arb, {
    minLength: constraints.minLength,
    maxLength: constraints.maxLength,
    size: constraints.size,
    depthIdentifier: constraints.depthIdentifier,
    comparator: "SameValueZero"
  }).map(arrayToSetMapper, arrayToSetUnmapper);
}
function dictOf(ka, va, maxKeys, size6, depthIdentifier, withNullPrototype) {
  return dictionary(ka, va, {
    maxKeys,
    noNullPrototype: !withNullPrototype,
    size: size6,
    depthIdentifier
  });
}
function typedArray(constraints) {
  return oneof(int8Array(constraints), uint8Array(constraints), uint8ClampedArray(constraints), int16Array(constraints), uint16Array(constraints), int32Array(constraints), uint32Array(constraints), float32Array(constraints), float64Array(constraints));
}
function anyArbitraryBuilder(constraints) {
  const arbitrariesForBase = constraints.values;
  const depthSize = constraints.depthSize;
  const depthIdentifier = createDepthIdentifier();
  const maxDepth = constraints.maxDepth;
  const maxKeys = constraints.maxKeys;
  const size6 = constraints.size;
  const baseArb = oneof(...arbitrariesForBase, ...constraints.withBigInt ? [bigInt2()] : [], ...constraints.withDate ? [date()] : []);
  return letrec((tie) => ({
    anything: oneof({
      maxDepth,
      depthSize,
      depthIdentifier
    }, baseArb, tie("array"), tie("object"), ...constraints.withMap ? [tie("map")] : [], ...constraints.withSet ? [tie("set")] : [], ...constraints.withObjectString ? [tie("anything").map((o) => stringify(o))] : [], ...constraints.withTypedArray ? [typedArray({
      maxLength: maxKeys,
      size: size6
    })] : [], ...constraints.withSparseArray ? [sparseArray(tie("anything"), {
      maxNumElements: maxKeys,
      size: size6,
      depthIdentifier
    })] : []),
    keys: constraints.withObjectString ? oneof({
      arbitrary: constraints.key,
      weight: 10
    }, {
      arbitrary: tie("anything").map((o) => stringify(o)),
      weight: 1
    }) : constraints.key,
    array: array3(tie("anything"), {
      maxLength: maxKeys,
      size: size6,
      depthIdentifier
    }),
    set: set3(tie("anything"), {
      maxLength: maxKeys,
      size: size6,
      depthIdentifier
    }),
    map: oneof(map10(tie("keys"), tie("anything"), {
      maxKeys,
      size: size6,
      depthIdentifier
    }), map10(tie("anything"), tie("anything"), {
      maxKeys,
      size: size6,
      depthIdentifier
    })),
    object: dictOf(tie("keys"), tie("anything"), maxKeys, size6, depthIdentifier, constraints.withNullPrototype)
  })).anything;
}
function unboxedToBoxedMapper(value3) {
  switch (typeof value3) {
    case "boolean":
      return new SBoolean(value3);
    case "number":
      return new SNumber(value3);
    case "string":
      return new SString(value3);
    default:
      return value3;
  }
}
function unboxedToBoxedUnmapper(value3) {
  if (typeof value3 !== "object" || value3 === null || !("constructor" in value3))
    return value3;
  return value3.constructor === SBoolean || value3.constructor === SNumber || value3.constructor === SString ? value3.valueOf() : value3;
}
function boxedArbitraryBuilder(arb) {
  return arb.map(unboxedToBoxedMapper, unboxedToBoxedUnmapper);
}
function defaultValues(constraints, stringArbitrary) {
  return [
    boolean2(),
    maxSafeInteger(),
    double(),
    stringArbitrary(constraints),
    oneof(stringArbitrary(constraints), constant2(null), constant2(undefined))
  ];
}
function boxArbitraries(arbs) {
  return arbs.map((arb) => boxedArbitraryBuilder(arb));
}
function boxArbitrariesIfNeeded(arbs, boxEnabled) {
  return boxEnabled ? boxArbitraries(arbs).concat(arbs) : arbs;
}
function toQualifiedObjectConstraints(settings = {}) {
  const valueConstraints = {
    size: settings.size,
    unit: "stringUnit" in settings ? settings.stringUnit : settings.withUnicodeString ? "binary" : undefined
  };
  return {
    key: settings.key !== undefined ? settings.key : string3(valueConstraints),
    values: boxArbitrariesIfNeeded(settings.values !== undefined ? settings.values : defaultValues(valueConstraints, string3), settings.withBoxedValues === true),
    depthSize: settings.depthSize,
    maxDepth: settings.maxDepth,
    maxKeys: settings.maxKeys,
    size: settings.size,
    withSet: settings.withSet === true,
    withMap: settings.withMap === true,
    withObjectString: settings.withObjectString === true,
    withNullPrototype: settings.withNullPrototype === true,
    withBigInt: settings.withBigInt === true,
    withDate: settings.withDate === true,
    withTypedArray: settings.withTypedArray === true,
    withSparseArray: settings.withSparseArray === true
  };
}
function objectInternal(constraints) {
  return dictionary(constraints.key, anyArbitraryBuilder(constraints), {
    maxKeys: constraints.maxKeys,
    noNullPrototype: !constraints.withNullPrototype,
    size: constraints.size
  });
}
function object(constraints) {
  return objectInternal(toQualifiedObjectConstraints(constraints));
}
function jsonConstraintsBuilder(stringArbitrary, constraints) {
  const { depthSize, maxDepth } = constraints;
  return {
    key: stringArbitrary,
    values: [
      boolean2(),
      double({
        noDefaultInfinity: true,
        noNaN: true
      }),
      stringArbitrary,
      constant2(null)
    ],
    depthSize,
    maxDepth
  };
}
function anything(constraints) {
  return anyArbitraryBuilder(toQualifiedObjectConstraints(constraints));
}
function jsonValue(constraints = {}) {
  const noUnicodeString = constraints.noUnicodeString === undefined || constraints.noUnicodeString === true;
  return anything(jsonConstraintsBuilder("stringUnit" in constraints ? string3({ unit: constraints.stringUnit }) : noUnicodeString ? string3() : string3({ unit: "binary" }), constraints));
}
var safeJsonStringify = JSON.stringify;
var safeJsonParse = JSON.parse;
function jsonStringUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new SError("Cannot unmap the passed value");
  return safeJsonParse(value3);
}
function json(constraints = {}) {
  return jsonValue(constraints).map(safeJsonStringify, jsonStringUnmapper);
}
var safeObjectDefineProperties = Object.defineProperties;
function prettyPrint(numSeen, seenValuesStrings) {
  return `Stream(${seenValuesStrings !== undefined ? `${safeJoin(seenValuesStrings, ",")}\u2026` : `${numSeen} emitted`})`;
}
var StreamArbitrary = class extends Arbitrary {
  constructor(arb, history) {
    super();
    this.arb = arb;
    this.history = history;
  }
  generate(mrng, biasFactor) {
    const appliedBiasFactor = biasFactor !== undefined && mrng.nextInt(1, biasFactor) === 1 ? biasFactor : undefined;
    const enrichedProducer = () => {
      const seenValues = this.history ? [] : null;
      let numSeenValues = 0;
      const g = function* (arb, clonedMrng) {
        while (true) {
          const value3 = arb.generate(clonedMrng, appliedBiasFactor).value;
          numSeenValues++;
          if (seenValues !== null)
            safePush(seenValues, value3);
          yield value3;
        }
      };
      return safeObjectDefineProperties(new Stream(g(this.arb, mrng.clone())), {
        toString: { value: () => prettyPrint(numSeenValues, seenValues !== null ? seenValues.map(stringify) : undefined) },
        [toStringMethod]: { value: () => prettyPrint(numSeenValues, seenValues !== null ? seenValues.map(stringify) : undefined) },
        [asyncToStringMethod]: { value: async () => prettyPrint(numSeenValues, seenValues !== null ? await Promise.all(seenValues.map(asyncStringify)) : undefined) },
        [cloneMethod]: {
          value: enrichedProducer,
          enumerable: true
        }
      });
    };
    return new Value(enrichedProducer(), undefined);
  }
  canShrinkWithoutContext(_value) {
    return false;
  }
  shrink(_value, _context) {
    return Stream.nil();
  }
};
function infiniteStream(arb, constraints) {
  return new StreamArbitrary(arb, constraints !== undefined && typeof constraints === "object" && "noHistory" in constraints ? !constraints.noHistory : true);
}
function codePointsToStringMapper(tab) {
  return safeJoin(tab, "");
}
function codePointsToStringUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Cannot unmap the passed value");
  return [...value3];
}
function stringToBase64Mapper(s) {
  switch (s.length % 4) {
    case 0:
      return s;
    case 3:
      return `${s}=`;
    case 2:
      return `${s}==`;
    default:
      return safeSubstring(s, 1);
  }
}
function stringToBase64Unmapper(value3) {
  if (typeof value3 !== "string" || value3.length % 4 !== 0)
    throw new Error("Invalid string received");
  const lastTrailingIndex = value3.indexOf("=");
  if (lastTrailingIndex === -1)
    return value3;
  if (value3.length - lastTrailingIndex > 2)
    throw new Error("Cannot unmap the passed value");
  return safeSubstring(value3, 0, lastTrailingIndex);
}
var safeStringFromCharCode = String.fromCharCode;
function base64Mapper(v) {
  if (v < 26)
    return safeStringFromCharCode(v + 65);
  if (v < 52)
    return safeStringFromCharCode(v + 97 - 26);
  if (v < 62)
    return safeStringFromCharCode(v + 48 - 52);
  return v === 62 ? "+" : "/";
}
function base64Unmapper(s) {
  if (typeof s !== "string" || s.length !== 1)
    throw new SError("Invalid entry");
  const v = safeCharCodeAt(s, 0);
  if (v >= 65 && v <= 90)
    return v - 65;
  if (v >= 97 && v <= 122)
    return v - 97 + 26;
  if (v >= 48 && v <= 57)
    return v - 48 + 52;
  return v === 43 ? 62 : v === 47 ? 63 : -1;
}
function base64() {
  return integer({
    min: 0,
    max: 63
  }).map(base64Mapper, base64Unmapper);
}
function base64String(constraints = {}) {
  const { minLength: unscaledMinLength = 0, maxLength: unscaledMaxLength = MaxLengthUpperBound, size: size6 } = constraints;
  const minLength = unscaledMinLength + 3 - (unscaledMinLength + 3) % 4;
  const maxLength = unscaledMaxLength - unscaledMaxLength % 4;
  const requestedSize = constraints.maxLength === undefined && size6 === undefined ? "=" : size6;
  if (minLength > maxLength)
    throw new SError("Minimal length should be inferior or equal to maximal length");
  if (minLength % 4 !== 0)
    throw new SError("Minimal length of base64 strings must be a multiple of 4");
  if (maxLength % 4 !== 0)
    throw new SError("Maximal length of base64 strings must be a multiple of 4");
  const charArbitrary = base64();
  return array3(charArbitrary, {
    minLength,
    maxLength,
    size: requestedSize,
    experimentalCustomSlices: createSlicesForStringLegacy(charArbitrary, codePointsToStringUnmapper)
  }).map(codePointsToStringMapper, codePointsToStringUnmapper).map(stringToBase64Mapper, stringToBase64Unmapper);
}
var safeObjectIs = Object.is;
function isSubarrayOf(source, small) {
  const countMap = new SMap$1;
  let countMinusZero = 0;
  for (const sourceEntry of source)
    if (safeObjectIs(sourceEntry, -0))
      ++countMinusZero;
    else
      safeMapSet(countMap, sourceEntry, (safeMapGet(countMap, sourceEntry) || 0) + 1);
  for (let index2 = 0;index2 !== small.length; ++index2) {
    if (!(index2 in small))
      return false;
    const smallEntry = small[index2];
    if (safeObjectIs(smallEntry, -0)) {
      if (countMinusZero === 0)
        return false;
      --countMinusZero;
    } else {
      const oldCount = safeMapGet(countMap, smallEntry) || 0;
      if (oldCount === 0)
        return false;
      safeMapSet(countMap, smallEntry, oldCount - 1);
    }
  }
  return true;
}
var safeMathFloor$1 = Math.floor;
var safeMathLog = Math.log;
var safeArrayIsArray = Array.isArray;
var SubarrayArbitrary = class extends Arbitrary {
  constructor(originalArray, isOrdered, minLength, maxLength) {
    super();
    this.originalArray = originalArray;
    this.isOrdered = isOrdered;
    this.minLength = minLength;
    this.maxLength = maxLength;
    if (minLength < 0 || minLength > originalArray.length)
      throw new Error("fc.*{s|S}ubarrayOf expects the minimal length to be between 0 and the size of the original array");
    if (maxLength < 0 || maxLength > originalArray.length)
      throw new Error("fc.*{s|S}ubarrayOf expects the maximal length to be between 0 and the size of the original array");
    if (minLength > maxLength)
      throw new Error("fc.*{s|S}ubarrayOf expects the minimal length to be inferior or equal to the maximal length");
    this.lengthArb = new IntegerArbitrary(minLength, maxLength);
    this.biasedLengthArb = minLength !== maxLength ? new IntegerArbitrary(minLength, minLength + safeMathFloor$1(safeMathLog(maxLength - minLength) / safeMathLog(2))) : this.lengthArb;
  }
  generate(mrng, biasFactor) {
    const size6 = (biasFactor !== undefined && mrng.nextInt(1, biasFactor) === 1 ? this.biasedLengthArb : this.lengthArb).generate(mrng, undefined);
    const sizeValue = size6.value;
    const remainingElements = safeMap(this.originalArray, (_v, idx) => idx);
    const ids = [];
    for (let index2 = 0;index2 !== sizeValue; ++index2) {
      const selectedIdIndex = mrng.nextInt(0, remainingElements.length - 1);
      safePush(ids, remainingElements[selectedIdIndex]);
      safeSplice(remainingElements, selectedIdIndex, 1);
    }
    if (this.isOrdered)
      safeSort(ids, (a, b) => a - b);
    return new Value(safeMap(ids, (i) => this.originalArray[i]), size6.context);
  }
  canShrinkWithoutContext(value3) {
    if (!safeArrayIsArray(value3))
      return false;
    if (!this.lengthArb.canShrinkWithoutContext(value3.length))
      return false;
    return isSubarrayOf(this.originalArray, value3);
  }
  shrink(value3, context3) {
    if (value3.length === 0)
      return Stream.nil();
    return this.lengthArb.shrink(value3.length, context3).map((newSize) => {
      return new Value(safeSlice(value3, value3.length - newSize.value), newSize.context);
    }).join(value3.length > this.minLength ? makeLazy2(() => this.shrink(safeSlice(value3, 1), undefined).filter((newValue) => this.minLength <= newValue.value.length + 1).map((newValue) => new Value([value3[0], ...newValue.value], undefined))) : Stream.nil());
  }
};
function subarray(originalArray, constraints = {}) {
  const { minLength = 0, maxLength = originalArray.length } = constraints;
  return new SubarrayArbitrary(originalArray, true, minLength, maxLength);
}
function shuffledSubarray(originalArray, constraints = {}) {
  const { minLength = 0, maxLength = originalArray.length } = constraints;
  return new SubarrayArbitrary(originalArray, false, minLength, maxLength);
}
var encodeSymbolLookupTable = {
  10: "A",
  11: "B",
  12: "C",
  13: "D",
  14: "E",
  15: "F",
  16: "G",
  17: "H",
  18: "J",
  19: "K",
  20: "M",
  21: "N",
  22: "P",
  23: "Q",
  24: "R",
  25: "S",
  26: "T",
  27: "V",
  28: "W",
  29: "X",
  30: "Y",
  31: "Z"
};
var decodeSymbolLookupTable = {
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  A: 10,
  B: 11,
  C: 12,
  D: 13,
  E: 14,
  F: 15,
  G: 16,
  H: 17,
  J: 18,
  K: 19,
  M: 20,
  N: 21,
  P: 22,
  Q: 23,
  R: 24,
  S: 25,
  T: 26,
  V: 27,
  W: 28,
  X: 29,
  Y: 30,
  Z: 31
};
function encodeSymbol(symbol4) {
  return symbol4 < 10 ? SString(symbol4) : encodeSymbolLookupTable[symbol4];
}
function pad(value3, paddingLength) {
  let extraPadding = "";
  while (value3.length + extraPadding.length < paddingLength)
    extraPadding += "0";
  return extraPadding + value3;
}
function smallUintToBase32StringMapper(num) {
  let base32Str = "";
  for (let remaining = num;remaining !== 0; ) {
    const next = remaining >> 5;
    base32Str = encodeSymbol(remaining - (next << 5)) + base32Str;
    remaining = next;
  }
  return base32Str;
}
function uintToBase32StringMapper(num, paddingLength) {
  const head = ~~(num / 1073741824);
  const tail = num & 1073741823;
  return pad(smallUintToBase32StringMapper(head), paddingLength - 6) + pad(smallUintToBase32StringMapper(tail), 6);
}
function paddedUintToBase32StringMapper(paddingLength) {
  return function padded(num) {
    return uintToBase32StringMapper(num, paddingLength);
  };
}
function uintToBase32StringUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new SError("Unsupported type");
  let accumulated = 0;
  let power = 1;
  for (let index2 = value3.length - 1;index2 >= 0; --index2) {
    const numericForChar = decodeSymbolLookupTable[value3[index2]];
    if (numericForChar === undefined)
      throw new SError("Unsupported type");
    accumulated += numericForChar * power;
    power *= 32;
  }
  return accumulated;
}
var padded10Mapper = paddedUintToBase32StringMapper(10);
var padded8Mapper = paddedUintToBase32StringMapper(8);
function ulidMapper(parts) {
  return padded10Mapper(parts[0]) + padded8Mapper(parts[1]) + padded8Mapper(parts[2]);
}
function ulidUnmapper(value3) {
  if (typeof value3 !== "string" || value3.length !== 26)
    throw new Error("Unsupported type");
  return [
    uintToBase32StringUnmapper(value3.slice(0, 10)),
    uintToBase32StringUnmapper(value3.slice(10, 18)),
    uintToBase32StringUnmapper(value3.slice(18))
  ];
}
function ulid() {
  return tuple2(integer({
    min: 0,
    max: 281474976710655
  }), integer({
    min: 0,
    max: 1099511627775
  }), integer({
    min: 0,
    max: 1099511627775
  })).map(ulidMapper, ulidUnmapper);
}
function numberToPaddedEightMapper(n) {
  return safePadStart(safeNumberToString(n, 16), 8, "0");
}
function numberToPaddedEightUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Unsupported type");
  if (value3.length !== 8)
    throw new Error("Unsupported value: invalid length");
  const n = parseInt(value3, 16);
  if (value3 !== numberToPaddedEightMapper(n))
    throw new Error("Unsupported value: invalid content");
  return n;
}
function buildPaddedNumberArbitrary(min4, max4) {
  return integer({
    min: min4,
    max: max4
  }).map(numberToPaddedEightMapper, numberToPaddedEightUnmapper);
}
function paddedEightsToUuidMapper(t) {
  return `${t[0]}-${safeSubstring(t[1], 4)}-${safeSubstring(t[1], 0, 4)}-${safeSubstring(t[2], 0, 4)}-${safeSubstring(t[2], 4)}${t[3]}`;
}
var UuidRegex = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/;
function paddedEightsToUuidUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Unsupported type");
  const m = UuidRegex.exec(value3);
  if (m === null)
    throw new Error("Unsupported type");
  return [
    m[1],
    m[3] + m[2],
    m[4] + safeSubstring(m[5], 0, 4),
    safeSubstring(m[5], 4)
  ];
}
var quickNumberToHexaString = "0123456789abcdef";
function buildVersionsAppliersForUuid(versions) {
  const mapping = {};
  const reversedMapping = {};
  for (let index2 = 0;index2 !== versions.length; ++index2) {
    const from = quickNumberToHexaString[index2];
    const to = quickNumberToHexaString[versions[index2]];
    mapping[from] = to;
    reversedMapping[to] = from;
  }
  function versionsApplierMapper(value3) {
    return mapping[value3[0]] + safeSubstring(value3, 1);
  }
  function versionsApplierUnmapper(value3) {
    if (typeof value3 !== "string")
      throw new SError("Cannot produce non-string values");
    const rev = reversedMapping[value3[0]];
    if (rev === undefined)
      throw new SError("Cannot produce strings not starting by the version in hexa code");
    return rev + safeSubstring(value3, 1);
  }
  return {
    versionsApplierMapper,
    versionsApplierUnmapper
  };
}
function assertValidVersions(versions) {
  const found = {};
  for (const version2 of versions) {
    if (found[version2])
      throw new SError(`Version ${version2} has been requested at least twice for uuid`);
    found[version2] = true;
    if (version2 < 1 || version2 > 15)
      throw new SError(`Version must be a value in [1-15] for uuid, but received ${version2}`);
    if (~~version2 !== version2)
      throw new SError(`Version must be an integer value for uuid, but received ${version2}`);
  }
  if (versions.length === 0)
    throw new SError(`Must provide at least one version for uuid`);
}
function uuid(constraints = {}) {
  const padded = buildPaddedNumberArbitrary(0, 4294967295);
  const version2 = constraints.version !== undefined ? typeof constraints.version === "number" ? [constraints.version] : constraints.version : [
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8
  ];
  assertValidVersions(version2);
  const { versionsApplierMapper, versionsApplierUnmapper } = buildVersionsAppliersForUuid(version2);
  return tuple2(padded, buildPaddedNumberArbitrary(0, 268435456 * version2.length - 1).map(versionsApplierMapper, versionsApplierUnmapper), buildPaddedNumberArbitrary(2147483648, 3221225471), padded).map(paddedEightsToUuidMapper, paddedEightsToUuidUnmapper);
}
function hostUserInfo(size6) {
  return string3({
    unit: getOrCreateAlphaNumericPercentArbitrary("-._~!$&'()*+,;=:"),
    size: size6
  });
}
function userHostPortMapper([u, h2, p]) {
  return (u === null ? "" : `${u}@`) + h2 + (p === null ? "" : `:${p}`);
}
function userHostPortUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Unsupported");
  const atPosition = value3.indexOf("@");
  const user = atPosition !== -1 ? value3.substring(0, atPosition) : null;
  const m = /:(\d+)$/.exec(value3);
  const port = m !== null ? Number(m[1]) : null;
  return [
    user,
    m !== null ? value3.substring(atPosition + 1, value3.length - m[1].length - 1) : value3.substring(atPosition + 1),
    port
  ];
}
function bracketedMapper(s) {
  return `[${s}]`;
}
function bracketedUnmapper(value3) {
  if (typeof value3 !== "string" || value3[0] !== "[" || value3[value3.length - 1] !== "]")
    throw new Error("Unsupported");
  return value3.substring(1, value3.length - 1);
}
function webAuthority(constraints) {
  const c = constraints || {};
  const size6 = c.size;
  const hostnameArbs = [
    domain({ size: size6 }),
    ...c.withIPv4 === true ? [ipV4()] : [],
    ...c.withIPv6 === true ? [ipV6().map(bracketedMapper, bracketedUnmapper)] : [],
    ...c.withIPv4Extended === true ? [ipV4Extended()] : []
  ];
  return tuple2(c.withUserInfo === true ? option2(hostUserInfo(size6)) : constant2(null), oneof(...hostnameArbs), c.withPort === true ? option2(nat(65535)) : constant2(null)).map(userHostPortMapper, userHostPortUnmapper);
}
function buildUriQueryOrFragmentArbitrary(size6) {
  return string3({
    unit: getOrCreateAlphaNumericPercentArbitrary("-._~!$&'()*+,;=:@/?"),
    size: size6
  });
}
function webFragments(constraints = {}) {
  return buildUriQueryOrFragmentArbitrary(constraints.size);
}
function webSegment(constraints = {}) {
  return string3({
    unit: getOrCreateAlphaNumericPercentArbitrary("-._~!$&'()*+,;=:@"),
    size: constraints.size
  });
}
function segmentsToPathMapper(segments) {
  return safeJoin(safeMap(segments, (v) => `/${v}`), "");
}
function segmentsToPathUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Incompatible value received: type");
  if (value3.length !== 0 && value3[0] !== "/")
    throw new Error("Incompatible value received: start");
  return safeSplice(safeSplit(value3, "/"), 1);
}
function sqrtSize(size6) {
  switch (size6) {
    case "xsmall":
      return ["xsmall", "xsmall"];
    case "small":
      return ["small", "xsmall"];
    case "medium":
      return ["small", "small"];
    case "large":
      return ["medium", "small"];
    case "xlarge":
      return ["medium", "medium"];
  }
}
function buildUriPathArbitraryInternal(segmentSize, numSegmentSize) {
  return array3(webSegment({ size: segmentSize }), { size: numSegmentSize }).map(segmentsToPathMapper, segmentsToPathUnmapper);
}
function buildUriPathArbitrary(resolvedSize) {
  const [segmentSize, numSegmentSize] = sqrtSize(resolvedSize);
  if (segmentSize === numSegmentSize)
    return buildUriPathArbitraryInternal(segmentSize, numSegmentSize);
  return oneof(buildUriPathArbitraryInternal(segmentSize, numSegmentSize), buildUriPathArbitraryInternal(numSegmentSize, segmentSize));
}
function webPath(constraints) {
  return buildUriPathArbitrary(resolveSize((constraints || {}).size));
}
function webQueryParameters(constraints = {}) {
  return buildUriQueryOrFragmentArbitrary(constraints.size);
}
function partsToUrlMapper(data) {
  const [scheme, authority, path] = data;
  return `${scheme}://${authority}${path}${data[3] === null ? "" : `?${data[3]}`}${data[4] === null ? "" : `#${data[4]}`}`;
}
var UrlSplitRegex = /^([[A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]*)?(#[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]*)?$/;
function partsToUrlUnmapper(value3) {
  if (typeof value3 !== "string")
    throw new Error("Incompatible value received: type");
  const m = UrlSplitRegex.exec(value3);
  if (m === null)
    throw new Error("Incompatible value received");
  const scheme = m[1];
  const authority = m[2];
  const path = m[3];
  const query = m[4];
  const fragments = m[5];
  return [
    scheme,
    authority,
    path,
    query !== undefined ? query.substring(1) : null,
    fragments !== undefined ? fragments.substring(1) : null
  ];
}
function webUrl(constraints) {
  const c = constraints || {};
  const resolvedSize = resolveSize(c.size);
  const resolvedAuthoritySettingsSize = c.authoritySettings !== undefined && c.authoritySettings.size !== undefined ? relativeSizeToSize(c.authoritySettings.size, resolvedSize) : resolvedSize;
  const resolvedAuthoritySettings = {
    ...c.authoritySettings,
    size: resolvedAuthoritySettingsSize
  };
  return tuple2(constantFrom(...c.validSchemes || ["http", "https"]), webAuthority(resolvedAuthoritySettings), webPath({ size: resolvedSize }), c.withQueryParameters === true ? option2(webQueryParameters({ size: resolvedSize })) : constant2(null), c.withFragments === true ? option2(webFragments({ size: resolvedSize })) : constant2(null)).map(partsToUrlMapper, partsToUrlUnmapper);
}
var CommandsIterable = class CommandsIterable2 {
  constructor(commands, metadataForReplay) {
    this.commands = commands;
    this.metadataForReplay = metadataForReplay;
    this[cloneMethod] = function() {
      return new CommandsIterable2(this.commands.map((c) => c.clone()), this.metadataForReplay);
    };
  }
  [Symbol.iterator]() {
    return this.commands[Symbol.iterator]();
  }
  toString() {
    const serializedCommands = this.commands.filter((c) => c.hasRan).map((c) => c.toString()).join(",");
    const metadata = this.metadataForReplay();
    return metadata.length !== 0 ? `${serializedCommands} /*${metadata}*/` : serializedCommands;
  }
};
var CommandWrapper = class CommandWrapper2 {
  constructor(cmd) {
    this.cmd = cmd;
    this.hasRan = false;
    if (hasToStringMethod(cmd)) {
      const method = cmd[toStringMethod];
      this[toStringMethod] = function toStringMethod2() {
        return method.call(cmd);
      };
    }
    if (hasAsyncToStringMethod(cmd)) {
      const method = cmd[asyncToStringMethod];
      this[asyncToStringMethod] = function asyncToStringMethod2() {
        return method.call(cmd);
      };
    }
  }
  check(m) {
    return this.cmd.check(m);
  }
  run(m, r) {
    this.hasRan = true;
    return this.cmd.run(m, r);
  }
  clone() {
    if (hasCloneMethod(this.cmd))
      return new CommandWrapper2(this.cmd[cloneMethod]());
    return new CommandWrapper2(this.cmd);
  }
  toString() {
    return this.cmd.toString();
  }
};
var ReplayPath = class {
  static parse(replayPathStr) {
    const [serializedCount, serializedChanges] = replayPathStr.split(":");
    const counts = this.parseCounts(serializedCount);
    const changes = this.parseChanges(serializedChanges);
    return this.parseOccurences(counts, changes);
  }
  static stringify(replayPath) {
    const occurences = this.countOccurences(replayPath);
    return `${this.stringifyCounts(occurences)}:${this.stringifyChanges(occurences)}`;
  }
  static intToB64(n) {
    if (n < 26)
      return String.fromCharCode(n + 65);
    if (n < 52)
      return String.fromCharCode(n + 97 - 26);
    if (n < 62)
      return String.fromCharCode(n + 48 - 52);
    return String.fromCharCode(n === 62 ? 43 : 47);
  }
  static b64ToInt(c) {
    if (c >= "a")
      return c.charCodeAt(0) - 97 + 26;
    if (c >= "A")
      return c.charCodeAt(0) - 65;
    if (c >= "0")
      return c.charCodeAt(0) - 48 + 52;
    return c === "+" ? 62 : 63;
  }
  static countOccurences(replayPath) {
    return replayPath.reduce((counts, cur) => {
      if (counts.length === 0 || counts[counts.length - 1].count === 64 || counts[counts.length - 1].value !== cur)
        counts.push({
          value: cur,
          count: 1
        });
      else
        counts[counts.length - 1].count += 1;
      return counts;
    }, []);
  }
  static parseOccurences(counts, changes) {
    const replayPath = [];
    for (let idx = 0;idx !== counts.length; ++idx) {
      const count = counts[idx];
      const value3 = changes[idx];
      for (let num = 0;num !== count; ++num)
        replayPath.push(value3);
    }
    return replayPath;
  }
  static stringifyChanges(occurences) {
    let serializedChanges = "";
    for (let idx = 0;idx < occurences.length; idx += 6) {
      const changesInt = occurences.slice(idx, idx + 6).reduceRight((prev, cur) => (prev << 1) + (cur.value ? 1 : 0), 0);
      serializedChanges += this.intToB64(changesInt);
    }
    return serializedChanges;
  }
  static parseChanges(serializedChanges) {
    const changesInt = serializedChanges.split("").map((c) => this.b64ToInt(c));
    const changes = [];
    for (let idx = 0;idx !== changesInt.length; ++idx) {
      let current = changesInt[idx];
      for (let n = 0;n !== 6; ++n, current >>= 1)
        changes.push(current % 2 === 1);
    }
    return changes;
  }
  static stringifyCounts(occurences) {
    return occurences.map(({ count }) => this.intToB64(count - 1)).join("");
  }
  static parseCounts(serializedCount) {
    return serializedCount.split("").map((c) => this.b64ToInt(c) + 1);
  }
};
var CommandsArbitrary = class extends Arbitrary {
  constructor(commandArbs, maxGeneratedCommands, maxCommands, sourceReplayPath, disableReplayLog) {
    super();
    this.sourceReplayPath = sourceReplayPath;
    this.disableReplayLog = disableReplayLog;
    this.oneCommandArb = oneof(...commandArbs).map((c) => new CommandWrapper(c));
    this.lengthArb = restrictedIntegerArbitraryBuilder(0, maxGeneratedCommands, maxCommands);
    this.replayPath = [];
    this.replayPathPosition = 0;
  }
  metadataForReplay() {
    return this.disableReplayLog ? "" : `replayPath=${JSON.stringify(ReplayPath.stringify(this.replayPath))}`;
  }
  buildValueFor(items2, shrunkOnce) {
    const commands = items2.map((item) => item.value_);
    const context3 = {
      shrunkOnce,
      items: items2
    };
    return new Value(new CommandsIterable(commands, () => this.metadataForReplay()), context3);
  }
  generate(mrng) {
    const sizeValue = this.lengthArb.generate(mrng, undefined).value;
    const items2 = Array(sizeValue);
    for (let idx = 0;idx !== sizeValue; ++idx)
      items2[idx] = this.oneCommandArb.generate(mrng, undefined);
    this.replayPathPosition = 0;
    return this.buildValueFor(items2, false);
  }
  canShrinkWithoutContext(_value) {
    return false;
  }
  filterOnExecution(itemsRaw) {
    const items2 = [];
    for (const c of itemsRaw)
      if (c.value_.hasRan) {
        this.replayPath.push(true);
        items2.push(c);
      } else
        this.replayPath.push(false);
    return items2;
  }
  filterOnReplay(itemsRaw) {
    return itemsRaw.filter((c, idx) => {
      const state = this.replayPath[this.replayPathPosition + idx];
      if (state === undefined)
        throw new Error(`Too short replayPath`);
      if (!state && c.value_.hasRan)
        throw new Error(`Mismatch between replayPath and real execution`);
      return state;
    });
  }
  filterForShrinkImpl(itemsRaw) {
    if (this.replayPathPosition === 0)
      this.replayPath = this.sourceReplayPath !== null ? ReplayPath.parse(this.sourceReplayPath) : [];
    const items2 = this.replayPathPosition < this.replayPath.length ? this.filterOnReplay(itemsRaw) : this.filterOnExecution(itemsRaw);
    this.replayPathPosition += itemsRaw.length;
    return items2;
  }
  shrink(_value, context3) {
    if (context3 === undefined)
      return Stream.nil();
    const safeContext = context3;
    const shrunkOnce = safeContext.shrunkOnce;
    const itemsRaw = safeContext.items;
    const items2 = this.filterForShrinkImpl(itemsRaw);
    if (items2.length === 0)
      return Stream.nil();
    const rootShrink = shrunkOnce ? Stream.nil() : new Stream([[]][Symbol.iterator]());
    const nextShrinks = [];
    for (let numToKeep = 0;numToKeep !== items2.length; ++numToKeep)
      nextShrinks.push(makeLazy2(() => {
        const fixedStart = items2.slice(0, numToKeep);
        return this.lengthArb.shrink(items2.length - 1 - numToKeep, undefined).map((l) => fixedStart.concat(items2.slice(items2.length - (l.value + 1))));
      }));
    for (let itemAt = 0;itemAt !== items2.length; ++itemAt)
      nextShrinks.push(makeLazy2(() => this.oneCommandArb.shrink(items2[itemAt].value_, items2[itemAt].context).map((v) => items2.slice(0, itemAt).concat([v], items2.slice(itemAt + 1)))));
    return rootShrink.join(...nextShrinks).map((shrinkables) => {
      return this.buildValueFor(shrinkables.map((c) => new Value(c.value_.clone(), c.context)), true);
    });
  }
};
function commands(commandArbs, constraints = {}) {
  const { size: size6, maxCommands = MaxLengthUpperBound, disableReplayLog = false, replayPath = null } = constraints;
  return new CommandsArbitrary(commandArbs, maxGeneratedLengthFromSizeForArbitrary(size6, 0, maxCommands, constraints.maxCommands !== undefined), maxCommands, replayPath, disableReplayLog);
}
var ScheduledCommand = class {
  constructor(s, cmd) {
    this.s = s;
    this.cmd = cmd;
  }
  async check(m) {
    let error = null;
    let checkPassed = false;
    if ((await this.s.scheduleSequence([{
      label: `check@${this.cmd.toString()}`,
      builder: async () => {
        try {
          checkPassed = await Promise.resolve(this.cmd.check(m));
        } catch (err) {
          error = err;
          throw err;
        }
      }
    }]).task).faulty)
      throw error;
    return checkPassed;
  }
  async run(m, r) {
    let error = null;
    if ((await this.s.scheduleSequence([{
      label: `run@${this.cmd.toString()}`,
      builder: async () => {
        try {
          await this.cmd.run(m, r);
        } catch (err) {
          error = err;
          throw err;
        }
      }
    }]).task).faulty)
      throw error;
  }
};
var scheduleCommands = function* (s, cmds) {
  for (const cmd of cmds)
    yield new ScheduledCommand(s, cmd);
};
var genericModelRun = (s, cmds, initialValue, runCmd, then) => {
  return s.then((o) => {
    const { model, real } = o;
    let state = initialValue;
    for (const c of cmds)
      state = then(state, () => {
        return runCmd(c, model, real);
      });
    return state;
  });
};
var internalModelRun = (s, cmds) => {
  const then = (_p, c) => c();
  const setupProducer = { then: (fun) => {
    fun(s());
  } };
  const runSync2 = (cmd, m, r) => {
    if (cmd.check(m))
      cmd.run(m, r);
  };
  return genericModelRun(setupProducer, cmds, undefined, runSync2, then);
};
var isAsyncSetup = (s) => {
  return typeof s.then === "function";
};
var internalAsyncModelRun = async (s, cmds, defaultPromise = Promise.resolve()) => {
  const then = (p, c) => p.then(c);
  const setupProducer = { then: (fun) => {
    const out = s();
    if (isAsyncSetup(out))
      return out.then(fun);
    else
      return fun(out);
  } };
  const runAsync = async (cmd, m, r) => {
    if (await cmd.check(m))
      await cmd.run(m, r);
  };
  return await genericModelRun(setupProducer, cmds, defaultPromise, runAsync, then);
};
function modelRun(s, cmds) {
  internalModelRun(s, cmds);
}
async function asyncModelRun(s, cmds) {
  await internalAsyncModelRun(s, cmds);
}
async function scheduledModelRun(scheduler, s, cmds) {
  const out = internalAsyncModelRun(s, scheduleCommands(scheduler, cmds), scheduler.schedule(Promise.resolve(), "startModel"));
  await scheduler.waitFor(out);
  await scheduler.waitAll();
}
var defaultSchedulerAct = (f) => f();
var SchedulerImplem = class SchedulerImplem2 {
  constructor(act, taskSelector) {
    this.act = act;
    this.taskSelector = taskSelector;
    this.lastTaskId = 0;
    this.sourceTaskSelector = taskSelector.clone();
    this.scheduledTasks = [];
    this.triggeredTasks = [];
    this.scheduledWatchers = [];
    this[cloneMethod] = function() {
      return new SchedulerImplem2(this.act, this.sourceTaskSelector);
    };
  }
  static buildLog(reportItem) {
    return `[task\${${reportItem.taskId}}] ${reportItem.label.length !== 0 ? `${reportItem.schedulingType}::${reportItem.label}` : reportItem.schedulingType} ${reportItem.status}${reportItem.outputValue !== undefined ? ` with value ${escapeForTemplateString(reportItem.outputValue)}` : ""}`;
  }
  log(schedulingType, taskId, label, metadata, status, data) {
    this.triggeredTasks.push({
      status,
      schedulingType,
      taskId,
      label,
      metadata,
      outputValue: data !== undefined ? stringify(data) : undefined
    });
  }
  scheduleInternal(schedulingType, label, task, metadata, customAct, thenTaskToBeAwaited) {
    const taskId = ++this.lastTaskId;
    let trigger = undefined;
    const scheduledPromise = new Promise((resolve2, reject) => {
      trigger = () => {
        const promise2 = Promise.resolve(thenTaskToBeAwaited !== undefined ? task.then(() => thenTaskToBeAwaited()) : task);
        promise2.then((data) => {
          this.log(schedulingType, taskId, label, metadata, "resolved", data);
          resolve2(data);
        }, (err) => {
          this.log(schedulingType, taskId, label, metadata, "rejected", err);
          reject(err);
        });
        return promise2;
      };
    });
    this.scheduledTasks.push({
      original: task,
      trigger,
      schedulingType,
      taskId,
      label,
      metadata,
      customAct
    });
    if (this.scheduledWatchers.length !== 0)
      this.scheduledWatchers[0]();
    return scheduledPromise;
  }
  schedule(task, label, metadata, customAct) {
    return this.scheduleInternal("promise", label || "", task, metadata, customAct || defaultSchedulerAct);
  }
  scheduleFunction(asyncFunction, customAct) {
    return (...args2) => this.scheduleInternal("function", `${asyncFunction.name}(${args2.map(stringify).join(",")})`, asyncFunction(...args2), undefined, customAct || defaultSchedulerAct);
  }
  scheduleSequence(sequenceBuilders, customAct) {
    const status = {
      done: false,
      faulty: false
    };
    const dummyResolvedPromise = { then: (f) => f() };
    let resolveSequenceTask = () => {};
    const sequenceTask = new Promise((resolve2) => {
      resolveSequenceTask = () => resolve2({
        done: status.done,
        faulty: status.faulty
      });
    });
    const onFaultyItemNoThrow = () => {
      status.faulty = true;
      resolveSequenceTask();
    };
    const onDone = () => {
      status.done = true;
      resolveSequenceTask();
    };
    const registerNextBuilder = (index2, previous) => {
      if (index2 >= sequenceBuilders.length) {
        previous.then(onDone, onFaultyItemNoThrow);
        return;
      }
      previous.then(() => {
        const item = sequenceBuilders[index2];
        const [builder, label, metadata] = typeof item === "function" ? [
          item,
          item.name,
          undefined
        ] : [
          item.builder,
          item.label,
          item.metadata
        ];
        const scheduled = this.scheduleInternal("sequence", label, dummyResolvedPromise, metadata, customAct || defaultSchedulerAct, () => builder());
        registerNextBuilder(index2 + 1, scheduled);
      }, onFaultyItemNoThrow);
    };
    registerNextBuilder(0, dummyResolvedPromise);
    return Object.assign(status, { task: sequenceTask });
  }
  count() {
    return this.scheduledTasks.length;
  }
  internalWaitOne() {
    if (this.scheduledTasks.length === 0)
      throw new Error("No task scheduled");
    const taskIndex = this.taskSelector.nextTaskIndex(this.scheduledTasks);
    const [scheduledTask] = this.scheduledTasks.splice(taskIndex, 1);
    return scheduledTask.customAct(() => {
      return scheduledTask.trigger().catch((_err) => {});
    });
  }
  waitOne(customAct) {
    const waitAct = customAct || defaultSchedulerAct;
    return this.act(() => waitAct(() => this.internalWaitOne()));
  }
  async waitAll(customAct) {
    while (this.scheduledTasks.length > 0)
      await this.waitOne(customAct);
  }
  async internalWaitFor(unscheduledTask, options) {
    let taskResolved = false;
    const customAct = options.customAct;
    const onWaitStart = options.onWaitStart;
    const onWaitIdle = options.onWaitIdle;
    const launchAwaiterOnInit = options.launchAwaiterOnInit;
    let resolveFinal = undefined;
    let rejectFinal = undefined;
    let awaiterTicks = 0;
    let awaiterPromise = null;
    let awaiterScheduledTaskPromise = null;
    const awaiter = async () => {
      awaiterTicks = 50;
      for (awaiterTicks = 50;!taskResolved && awaiterTicks > 0; --awaiterTicks)
        await Promise.resolve();
      if (!taskResolved && this.scheduledTasks.length > 0) {
        if (onWaitStart !== undefined)
          onWaitStart();
        awaiterScheduledTaskPromise = this.waitOne(customAct);
        return awaiterScheduledTaskPromise.then(() => {
          awaiterScheduledTaskPromise = null;
          return awaiter();
        }, (err) => {
          awaiterScheduledTaskPromise = null;
          taskResolved = true;
          rejectFinal(err);
          throw err;
        });
      }
      if (!taskResolved && onWaitIdle !== undefined)
        onWaitIdle();
      awaiterPromise = null;
    };
    const handleNotified = () => {
      if (awaiterPromise !== null) {
        awaiterTicks = 51;
        return;
      }
      awaiterPromise = awaiter().catch(() => {});
    };
    const clearAndReplaceWatcher = () => {
      const handleNotifiedIndex = this.scheduledWatchers.indexOf(handleNotified);
      if (handleNotifiedIndex !== -1)
        this.scheduledWatchers.splice(handleNotifiedIndex, 1);
      if (handleNotifiedIndex === 0 && this.scheduledWatchers.length !== 0)
        this.scheduledWatchers[0]();
    };
    const finalTask = new Promise((resolve2, reject) => {
      resolveFinal = (value3) => {
        clearAndReplaceWatcher();
        resolve2(value3);
      };
      rejectFinal = (error) => {
        clearAndReplaceWatcher();
        reject(error);
      };
    });
    unscheduledTask.then((ret) => {
      taskResolved = true;
      if (awaiterScheduledTaskPromise === null)
        resolveFinal(ret);
      else
        awaiterScheduledTaskPromise.then(() => resolveFinal(ret), (error) => rejectFinal(error));
    }, (err) => {
      taskResolved = true;
      if (awaiterScheduledTaskPromise === null)
        rejectFinal(err);
      else
        awaiterScheduledTaskPromise.then(() => rejectFinal(err), () => rejectFinal(err));
    });
    if ((this.scheduledTasks.length > 0 || launchAwaiterOnInit) && this.scheduledWatchers.length === 0)
      handleNotified();
    this.scheduledWatchers.push(handleNotified);
    return finalTask;
  }
  waitNext(count, customAct) {
    let resolver = undefined;
    let remaining = count;
    const awaited = remaining <= 0 ? Promise.resolve() : new Promise((r) => {
      resolver = () => {
        if (--remaining <= 0)
          r();
      };
    });
    return this.internalWaitFor(awaited, {
      customAct,
      onWaitStart: resolver,
      onWaitIdle: undefined,
      launchAwaiterOnInit: false
    });
  }
  waitIdle(customAct) {
    let resolver = undefined;
    const awaited = new Promise((r) => resolver = r);
    return this.internalWaitFor(awaited, {
      customAct,
      onWaitStart: undefined,
      onWaitIdle: resolver,
      launchAwaiterOnInit: true
    });
  }
  waitFor(unscheduledTask, customAct) {
    return this.internalWaitFor(unscheduledTask, {
      customAct,
      onWaitStart: undefined,
      onWaitIdle: undefined,
      launchAwaiterOnInit: false
    });
  }
  report() {
    return [...this.triggeredTasks, ...this.scheduledTasks.map((t) => ({
      status: "pending",
      schedulingType: t.schedulingType,
      taskId: t.taskId,
      label: t.label,
      metadata: t.metadata
    }))];
  }
  toString() {
    return "schedulerFor()`\n" + this.report().map(SchedulerImplem2.buildLog).map((log) => `-> ${log}`).join(`
`) + "`";
  }
};
function buildNextTaskIndex$1(ordering) {
  let numTasks = 0;
  return {
    clone: () => buildNextTaskIndex$1(ordering),
    nextTaskIndex: (scheduledTasks) => {
      if (ordering.length <= numTasks)
        throw new Error(`Invalid schedulerFor defined: too many tasks have been scheduled`);
      const taskIndex = scheduledTasks.findIndex((t) => t.taskId === ordering[numTasks]);
      if (taskIndex === -1)
        throw new Error(`Invalid schedulerFor defined: unable to find next task`);
      ++numTasks;
      return taskIndex;
    }
  };
}
function buildSchedulerFor(act, ordering) {
  return new SchedulerImplem(act, buildNextTaskIndex$1(ordering));
}
function buildNextTaskIndex(mrng) {
  const clonedMrng = mrng.clone();
  return {
    clone: () => buildNextTaskIndex(clonedMrng),
    nextTaskIndex: (scheduledTasks) => {
      return mrng.nextInt(0, scheduledTasks.length - 1);
    }
  };
}
var SchedulerArbitrary = class extends Arbitrary {
  constructor(act) {
    super();
    this.act = act;
  }
  generate(mrng, _biasFactor) {
    return new Value(new SchedulerImplem(this.act, buildNextTaskIndex(mrng.clone())), undefined);
  }
  canShrinkWithoutContext(_value) {
    return false;
  }
  shrink(_value, _context) {
    return Stream.nil();
  }
};
function scheduler(constraints) {
  const { act = (f) => f() } = constraints || {};
  return new SchedulerArbitrary(act);
}
function schedulerFor(customOrderingOrConstraints, constraintsOrUndefined) {
  const { act = (f) => f() } = Array.isArray(customOrderingOrConstraints) ? constraintsOrUndefined || {} : customOrderingOrConstraints || {};
  if (Array.isArray(customOrderingOrConstraints))
    return buildSchedulerFor(act, customOrderingOrConstraints);
  return function(_strs, ...ordering) {
    return buildSchedulerFor(act, ordering);
  };
}
function bigInt64Array(constraints = {}) {
  return typedIntArrayArbitraryArbitraryBuilder(constraints, SBigInt2("-9223372036854775808"), SBigInt2("9223372036854775807"), SBigInt64Array, bigInt2);
}
function bigUint64Array(constraints = {}) {
  return typedIntArrayArbitraryArbitraryBuilder(constraints, SBigInt2(0), SBigInt2("18446744073709551615"), SBigUint64Array, bigInt2);
}
function noSuchValue(_value, returnedValue) {
  return returnedValue;
}
var safeMathFloor = Math.floor;
var safeMathMin = Math.min;
function clampRegexAstInternal(astNode, maxLength) {
  switch (astNode.type) {
    case "Char":
      return {
        astNode,
        minLength: 1
      };
    case "Repetition":
      switch (astNode.quantifier.kind) {
        case "*": {
          const clamped = clampRegexAstInternal(astNode.expression, maxLength);
          return {
            astNode: {
              type: "Repetition",
              quantifier: {
                ...astNode.quantifier,
                kind: "Range",
                from: 0,
                to: maxLength
              },
              expression: clamped.astNode
            },
            minLength: 0
          };
        }
        case "+": {
          const clamped = clampRegexAstInternal(astNode.expression, maxLength);
          const scaledClampedMinLength = clamped.minLength > 1 ? clamped.minLength : 1;
          return {
            astNode: {
              type: "Repetition",
              quantifier: {
                ...astNode.quantifier,
                kind: "Range",
                from: 1,
                to: safeMathFloor(maxLength / scaledClampedMinLength)
              },
              expression: clamped.astNode
            },
            minLength: clamped.minLength
          };
        }
        case "?": {
          const clamped = clampRegexAstInternal(astNode.expression, maxLength);
          if (maxLength < clamped.minLength)
            return {
              astNode: {
                type: "Repetition",
                quantifier: {
                  ...astNode.quantifier,
                  kind: "Range",
                  from: 0,
                  to: 0
                },
                expression: clamped.astNode
              },
              minLength: 0
            };
          return {
            astNode: {
              ...astNode,
              expression: clamped.astNode
            },
            minLength: 0
          };
        }
        case "Range": {
          const scaledMaxLength = astNode.quantifier.from > 1 ? safeMathFloor(maxLength / astNode.quantifier.from) : maxLength;
          const clamped = clampRegexAstInternal(astNode.expression, scaledMaxLength);
          const scaledClampedMinLength = clamped.minLength > 1 ? clamped.minLength : 1;
          if (astNode.quantifier.to === undefined || astNode.quantifier.to * scaledClampedMinLength > maxLength)
            return {
              astNode: {
                type: "Repetition",
                quantifier: {
                  ...astNode.quantifier,
                  kind: "Range",
                  to: safeMathFloor(maxLength / scaledClampedMinLength)
                },
                expression: clamped.astNode
              },
              minLength: astNode.quantifier.from * clamped.minLength
            };
          return {
            astNode: {
              ...astNode,
              expression: clamped.astNode
            },
            minLength: astNode.quantifier.from * clamped.minLength
          };
        }
        default:
          return noSuchValue(astNode.quantifier, {
            astNode,
            minLength: 0
          });
      }
    case "Quantifier":
      return {
        astNode,
        minLength: 0
      };
    case "Alternative": {
      let totalMinLength = 0;
      const extendedClampeds = [];
      for (let index2 = 0;index2 !== astNode.expressions.length; ++index2) {
        const temporaryAllowance = maxLength - totalMinLength;
        const clamped = clampRegexAstInternal(astNode.expressions[index2], temporaryAllowance);
        totalMinLength += clamped.minLength;
        safePush(extendedClampeds, {
          value: clamped,
          allowance: temporaryAllowance
        });
      }
      const refinedExpressions = [];
      for (let index2 = 0;index2 !== extendedClampeds.length; ++index2) {
        const current = extendedClampeds[index2].value;
        const pastAllowance = extendedClampeds[index2].allowance;
        const allowance = maxLength - totalMinLength + current.minLength;
        safePush(refinedExpressions, (allowance !== pastAllowance ? clampRegexAstInternal(current.astNode, allowance) : current).astNode);
      }
      return {
        astNode: {
          ...astNode,
          expressions: refinedExpressions
        },
        minLength: totalMinLength
      };
    }
    case "CharacterClass":
      return {
        astNode,
        minLength: 1
      };
    case "ClassRange":
      return {
        astNode,
        minLength: 1
      };
    case "Group": {
      const clamped = clampRegexAstInternal(astNode.expression, maxLength);
      return {
        astNode: {
          ...astNode,
          expression: clamped.astNode
        },
        minLength: clamped.minLength
      };
    }
    case "Disjunction": {
      if (astNode.left === null) {
        if (astNode.right === null)
          return {
            astNode,
            minLength: 0
          };
        const clampedRight2 = clampRegexAstInternal(astNode.right, maxLength);
        const refinedRight = clampedRight2.minLength > maxLength ? null : clampedRight2.astNode;
        return {
          astNode: {
            ...astNode,
            left: null,
            right: refinedRight
          },
          minLength: 0
        };
      }
      if (astNode.right === null) {
        const clampLeft = clampRegexAstInternal(astNode.left, maxLength);
        const refinedLeft = clampLeft.minLength > maxLength ? null : clampLeft.astNode;
        return {
          astNode: {
            ...astNode,
            left: refinedLeft,
            right: null
          },
          minLength: 0
        };
      }
      const clampedLeft = clampRegexAstInternal(astNode.left, maxLength);
      const clampedRight = clampRegexAstInternal(astNode.right, maxLength);
      if (clampedLeft.minLength > maxLength)
        return clampedRight;
      if (clampedRight.minLength > maxLength)
        return clampedLeft;
      return {
        astNode: {
          ...astNode,
          left: clampedLeft.astNode,
          right: clampedRight.astNode
        },
        minLength: safeMathMin(clampedLeft.minLength, clampedRight.minLength)
      };
    }
    case "Assertion":
      return {
        astNode,
        minLength: 0
      };
    case "Backreference":
      return {
        astNode,
        minLength: 0
      };
    case "UnicodeProperty":
      return {
        astNode,
        minLength: 1
      };
  }
}
function clampRegexAst(astNode, maxLength) {
  return clampRegexAstInternal(astNode, maxLength).astNode;
}
function raiseUnsupportedASTNode$1(astNode) {
  return /* @__PURE__ */ new Error(`Unsupported AST node! Received: ${stringify(astNode)}`);
}
function addMissingDotStarTraversalAddMissing(astNode, isFirst, isLast) {
  if (!isFirst && !isLast)
    return astNode;
  const traversalResults = {
    hasStart: false,
    hasEnd: false
  };
  const revampedNode = addMissingDotStarTraversal(astNode, isFirst, isLast, traversalResults);
  const missingStart = isFirst && !traversalResults.hasStart;
  const missingEnd = isLast && !traversalResults.hasEnd;
  if (!missingStart && !missingEnd)
    return revampedNode;
  const expressions = [];
  if (missingStart) {
    expressions.push({
      type: "Assertion",
      kind: "^"
    });
    expressions.push({
      type: "Repetition",
      quantifier: {
        type: "Quantifier",
        kind: "*",
        greedy: true
      },
      expression: {
        type: "Char",
        kind: "meta",
        symbol: ".",
        value: ".",
        codePoint: NaN
      }
    });
  }
  expressions.push(revampedNode);
  if (missingEnd) {
    expressions.push({
      type: "Repetition",
      quantifier: {
        type: "Quantifier",
        kind: "*",
        greedy: true
      },
      expression: {
        type: "Char",
        kind: "meta",
        symbol: ".",
        value: ".",
        codePoint: NaN
      }
    });
    expressions.push({
      type: "Assertion",
      kind: "$"
    });
  }
  return {
    type: "Group",
    capturing: false,
    expression: {
      type: "Alternative",
      expressions
    }
  };
}
function addMissingDotStarTraversal(astNode, isFirst, isLast, traversalResults) {
  switch (astNode.type) {
    case "Char":
      return astNode;
    case "Repetition":
      return astNode;
    case "Quantifier":
      throw new Error(`Wrongly defined AST tree, Quantifier nodes not supposed to be scanned!`);
    case "Alternative":
      traversalResults.hasStart = true;
      traversalResults.hasEnd = true;
      return {
        ...astNode,
        expressions: astNode.expressions.map((node, index2) => addMissingDotStarTraversalAddMissing(node, isFirst && index2 === 0, isLast && index2 === astNode.expressions.length - 1))
      };
    case "CharacterClass":
      return astNode;
    case "ClassRange":
      return astNode;
    case "Group":
      return {
        ...astNode,
        expression: addMissingDotStarTraversal(astNode.expression, isFirst, isLast, traversalResults)
      };
    case "Disjunction":
      traversalResults.hasStart = true;
      traversalResults.hasEnd = true;
      return {
        ...astNode,
        left: astNode.left !== null ? addMissingDotStarTraversalAddMissing(astNode.left, isFirst, isLast) : null,
        right: astNode.right !== null ? addMissingDotStarTraversalAddMissing(astNode.right, isFirst, isLast) : null
      };
    case "Assertion":
      if (astNode.kind === "^" || astNode.kind === "Lookahead") {
        traversalResults.hasStart = true;
        return astNode;
      } else if (astNode.kind === "$" || astNode.kind === "Lookbehind") {
        traversalResults.hasEnd = true;
        return astNode;
      } else
        throw new Error(`Assertions of kind ${astNode.kind} not implemented yet!`);
    case "Backreference":
      return astNode;
    case "UnicodeProperty":
      return astNode;
    default:
      throw raiseUnsupportedASTNode$1(astNode);
  }
}
function addMissingDotStar(astNode) {
  return addMissingDotStarTraversalAddMissing(astNode, true, true);
}
function charSizeAt(text, pos) {
  return text[pos] >= "\uD800" && text[pos] <= "\uDBFF" && text[pos + 1] >= "\uDC00" && text[pos + 1] <= "\uDFFF" ? 2 : 1;
}
function isHexaDigit(char) {
  return char >= "0" && char <= "9" || char >= "a" && char <= "f" || char >= "A" && char <= "F";
}
function isDigit$1(char) {
  return char >= "0" && char <= "9";
}
function squaredBracketBlockContentEndFrom(text, from) {
  for (let index2 = from;index2 !== text.length; ++index2) {
    const char = text[index2];
    if (char === "\\")
      index2 += 1;
    else if (char === "]")
      return index2;
  }
  throw new Error(`Missing closing ']'`);
}
function parenthesisBlockContentEndFrom(text, from) {
  let numExtraOpened = 0;
  for (let index2 = from;index2 !== text.length; ++index2) {
    const char = text[index2];
    if (char === "\\")
      index2 += 1;
    else if (char === ")") {
      if (numExtraOpened === 0)
        return index2;
      numExtraOpened -= 1;
    } else if (char === "[")
      index2 = squaredBracketBlockContentEndFrom(text, index2);
    else if (char === "(")
      numExtraOpened += 1;
  }
  throw new Error(`Missing closing ')'`);
}
function curlyBracketBlockContentEndFrom(text, from) {
  let foundComma = false;
  for (let index2 = from;index2 !== text.length; ++index2) {
    const char = text[index2];
    if (isDigit$1(char)) {} else if (from === index2)
      return -1;
    else if (char === ",") {
      if (foundComma)
        return -1;
      foundComma = true;
    } else if (char === "}")
      return index2;
    else
      return -1;
  }
  return -1;
}
function blockEndFrom(text, from, unicodeMode, mode) {
  switch (text[from]) {
    case "[":
      if (mode === 1)
        return from + 1;
      return squaredBracketBlockContentEndFrom(text, from + 1) + 1;
    case "{": {
      if (mode === 1)
        return from + 1;
      const foundEnd = curlyBracketBlockContentEndFrom(text, from + 1);
      if (foundEnd === -1)
        return from + 1;
      return foundEnd + 1;
    }
    case "(":
      if (mode === 1)
        return from + 1;
      return parenthesisBlockContentEndFrom(text, from + 1) + 1;
    case "]":
    case "}":
    case ")":
      return from + 1;
    case "\\": {
      const next1 = text[from + 1];
      switch (next1) {
        case "x":
          if (isHexaDigit(text[from + 2]) && isHexaDigit(text[from + 3]))
            return from + 4;
          throw new Error(`Unexpected token '${text.substring(from, from + 4)}' found`);
        case "u":
          if (text[from + 2] === "{") {
            if (!unicodeMode)
              return from + 2;
            if (text[from + 4] === "}") {
              if (isHexaDigit(text[from + 3]))
                return from + 5;
              throw new Error(`Unexpected token '${text.substring(from, from + 5)}' found`);
            }
            if (text[from + 5] === "}") {
              if (isHexaDigit(text[from + 3]) && isHexaDigit(text[from + 4]))
                return from + 6;
              throw new Error(`Unexpected token '${text.substring(from, from + 6)}' found`);
            }
            if (text[from + 6] === "}") {
              if (isHexaDigit(text[from + 3]) && isHexaDigit(text[from + 4]) && isHexaDigit(text[from + 5]))
                return from + 7;
              throw new Error(`Unexpected token '${text.substring(from, from + 7)}' found`);
            }
            if (text[from + 7] === "}") {
              if (isHexaDigit(text[from + 3]) && isHexaDigit(text[from + 4]) && isHexaDigit(text[from + 5]) && isHexaDigit(text[from + 6]))
                return from + 8;
              throw new Error(`Unexpected token '${text.substring(from, from + 8)}' found`);
            }
            if (text[from + 8] === "}" && isHexaDigit(text[from + 3]) && isHexaDigit(text[from + 4]) && isHexaDigit(text[from + 5]) && isHexaDigit(text[from + 6]) && isHexaDigit(text[from + 7]))
              return from + 9;
            throw new Error(`Unexpected token '${text.substring(from, from + 9)}' found`);
          }
          if (isHexaDigit(text[from + 2]) && isHexaDigit(text[from + 3]) && isHexaDigit(text[from + 4]) && isHexaDigit(text[from + 5]))
            return from + 6;
          throw new Error(`Unexpected token '${text.substring(from, from + 6)}' found`);
        case "p":
        case "P": {
          if (!unicodeMode)
            return from + 2;
          let subIndex = from + 2;
          for (;subIndex < text.length && text[subIndex] !== "}"; subIndex += text[subIndex] === "\\" ? 2 : 1)
            ;
          if (text[subIndex] !== "}")
            throw new Error(`Invalid \\P definition`);
          return subIndex + 1;
        }
        case "k": {
          let subIndex = from + 2;
          for (;subIndex < text.length && text[subIndex] !== ">"; ++subIndex)
            ;
          if (text[subIndex] !== ">") {
            if (!unicodeMode)
              return from + 2;
            throw new Error(`Invalid \\k definition`);
          }
          return subIndex + 1;
        }
        default:
          if (isDigit$1(next1)) {
            const maxIndex = unicodeMode ? text.length : Math.min(from + 4, text.length);
            let subIndex = from + 2;
            for (;subIndex < maxIndex && isDigit$1(text[subIndex]); ++subIndex)
              ;
            return subIndex;
          }
          return from + (unicodeMode ? charSizeAt(text, from + 1) : 1) + 1;
      }
    }
    default:
      return from + (unicodeMode ? charSizeAt(text, from) : 1);
  }
}
function readFrom(text, from, unicodeMode, mode) {
  const to = blockEndFrom(text, from, unicodeMode, mode);
  return text.substring(from, to);
}
var NON_BINARY_ALIASES_TO_PROP_NAMES = {
  gc: "General_Category",
  sc: "Script",
  scx: "Script_Extensions"
};
var BINARY_PROP_NAMES_TO_ALIASES = {
  ASCII: "ASCII",
  ASCII_Hex_Digit: "AHex",
  Alphabetic: "Alpha",
  Any: "Any",
  Assigned: "Assigned",
  Bidi_Control: "Bidi_C",
  Bidi_Mirrored: "Bidi_M",
  Case_Ignorable: "CI",
  Cased: "Cased",
  Changes_When_Casefolded: "CWCF",
  Changes_When_Casemapped: "CWCM",
  Changes_When_Lowercased: "CWL",
  Changes_When_NFKC_Casefolded: "CWKCF",
  Changes_When_Titlecased: "CWT",
  Changes_When_Uppercased: "CWU",
  Dash: "Dash",
  Default_Ignorable_Code_Point: "DI",
  Deprecated: "Dep",
  Diacritic: "Dia",
  Emoji: "Emoji",
  Emoji_Component: "Emoji_Component",
  Emoji_Modifier: "Emoji_Modifier",
  Emoji_Modifier_Base: "Emoji_Modifier_Base",
  Emoji_Presentation: "Emoji_Presentation",
  Extended_Pictographic: "Extended_Pictographic",
  Extender: "Ext",
  Grapheme_Base: "Gr_Base",
  Grapheme_Extend: "Gr_Ext",
  Hex_Digit: "Hex",
  IDS_Binary_Operator: "IDSB",
  IDS_Trinary_Operator: "IDST",
  ID_Continue: "IDC",
  ID_Start: "IDS",
  Ideographic: "Ideo",
  Join_Control: "Join_C",
  Logical_Order_Exception: "LOE",
  Lowercase: "Lower",
  Math: "Math",
  Noncharacter_Code_Point: "NChar",
  Pattern_Syntax: "Pat_Syn",
  Pattern_White_Space: "Pat_WS",
  Quotation_Mark: "QMark",
  Radical: "Radical",
  Regional_Indicator: "RI",
  Sentence_Terminal: "STerm",
  Soft_Dotted: "SD",
  Terminal_Punctuation: "Term",
  Unified_Ideograph: "UIdeo",
  Uppercase: "Upper",
  Variation_Selector: "VS",
  White_Space: "space",
  XID_Continue: "XIDC",
  XID_Start: "XIDS"
};
var BINARY_ALIASES_TO_PROP_NAMES = inverseMap(BINARY_PROP_NAMES_TO_ALIASES);
var GENERAL_CATEGORY_VALUE_TO_ALIASES = {
  Cased_Letter: "LC",
  Close_Punctuation: "Pe",
  Connector_Punctuation: "Pc",
  Control: ["Cc", "cntrl"],
  Currency_Symbol: "Sc",
  Dash_Punctuation: "Pd",
  Decimal_Number: ["Nd", "digit"],
  Enclosing_Mark: "Me",
  Final_Punctuation: "Pf",
  Format: "Cf",
  Initial_Punctuation: "Pi",
  Letter: "L",
  Letter_Number: "Nl",
  Line_Separator: "Zl",
  Lowercase_Letter: "Ll",
  Mark: ["M", "Combining_Mark"],
  Math_Symbol: "Sm",
  Modifier_Letter: "Lm",
  Modifier_Symbol: "Sk",
  Nonspacing_Mark: "Mn",
  Number: "N",
  Open_Punctuation: "Ps",
  Other: "C",
  Other_Letter: "Lo",
  Other_Number: "No",
  Other_Punctuation: "Po",
  Other_Symbol: "So",
  Paragraph_Separator: "Zp",
  Private_Use: "Co",
  Punctuation: ["P", "punct"],
  Separator: "Z",
  Space_Separator: "Zs",
  Spacing_Mark: "Mc",
  Surrogate: "Cs",
  Symbol: "S",
  Titlecase_Letter: "Lt",
  Unassigned: "Cn",
  Uppercase_Letter: "Lu"
};
var GENERAL_CATEGORY_VALUE_ALIASES_TO_VALUES = inverseMap(GENERAL_CATEGORY_VALUE_TO_ALIASES);
var SCRIPT_VALUE_TO_ALIASES = {
  Adlam: "Adlm",
  Ahom: "Ahom",
  Anatolian_Hieroglyphs: "Hluw",
  Arabic: "Arab",
  Armenian: "Armn",
  Avestan: "Avst",
  Balinese: "Bali",
  Bamum: "Bamu",
  Bassa_Vah: "Bass",
  Batak: "Batk",
  Bengali: "Beng",
  Bhaiksuki: "Bhks",
  Bopomofo: "Bopo",
  Brahmi: "Brah",
  Braille: "Brai",
  Buginese: "Bugi",
  Buhid: "Buhd",
  Canadian_Aboriginal: "Cans",
  Carian: "Cari",
  Caucasian_Albanian: "Aghb",
  Chakma: "Cakm",
  Cham: "Cham",
  Cherokee: "Cher",
  Common: "Zyyy",
  Coptic: ["Copt", "Qaac"],
  Cuneiform: "Xsux",
  Cypriot: "Cprt",
  Cyrillic: "Cyrl",
  Deseret: "Dsrt",
  Devanagari: "Deva",
  Dogra: "Dogr",
  Duployan: "Dupl",
  Egyptian_Hieroglyphs: "Egyp",
  Elbasan: "Elba",
  Ethiopic: "Ethi",
  Georgian: "Geor",
  Glagolitic: "Glag",
  Gothic: "Goth",
  Grantha: "Gran",
  Greek: "Grek",
  Gujarati: "Gujr",
  Gunjala_Gondi: "Gong",
  Gurmukhi: "Guru",
  Han: "Hani",
  Hangul: "Hang",
  Hanifi_Rohingya: "Rohg",
  Hanunoo: "Hano",
  Hatran: "Hatr",
  Hebrew: "Hebr",
  Hiragana: "Hira",
  Imperial_Aramaic: "Armi",
  Inherited: ["Zinh", "Qaai"],
  Inscriptional_Pahlavi: "Phli",
  Inscriptional_Parthian: "Prti",
  Javanese: "Java",
  Kaithi: "Kthi",
  Kannada: "Knda",
  Katakana: "Kana",
  Kayah_Li: "Kali",
  Kharoshthi: "Khar",
  Khmer: "Khmr",
  Khojki: "Khoj",
  Khudawadi: "Sind",
  Lao: "Laoo",
  Latin: "Latn",
  Lepcha: "Lepc",
  Limbu: "Limb",
  Linear_A: "Lina",
  Linear_B: "Linb",
  Lisu: "Lisu",
  Lycian: "Lyci",
  Lydian: "Lydi",
  Mahajani: "Mahj",
  Makasar: "Maka",
  Malayalam: "Mlym",
  Mandaic: "Mand",
  Manichaean: "Mani",
  Marchen: "Marc",
  Medefaidrin: "Medf",
  Masaram_Gondi: "Gonm",
  Meetei_Mayek: "Mtei",
  Mende_Kikakui: "Mend",
  Meroitic_Cursive: "Merc",
  Meroitic_Hieroglyphs: "Mero",
  Miao: "Plrd",
  Modi: "Modi",
  Mongolian: "Mong",
  Mro: "Mroo",
  Multani: "Mult",
  Myanmar: "Mymr",
  Nabataean: "Nbat",
  New_Tai_Lue: "Talu",
  Newa: "Newa",
  Nko: "Nkoo",
  Nushu: "Nshu",
  Ogham: "Ogam",
  Ol_Chiki: "Olck",
  Old_Hungarian: "Hung",
  Old_Italic: "Ital",
  Old_North_Arabian: "Narb",
  Old_Permic: "Perm",
  Old_Persian: "Xpeo",
  Old_Sogdian: "Sogo",
  Old_South_Arabian: "Sarb",
  Old_Turkic: "Orkh",
  Oriya: "Orya",
  Osage: "Osge",
  Osmanya: "Osma",
  Pahawh_Hmong: "Hmng",
  Palmyrene: "Palm",
  Pau_Cin_Hau: "Pauc",
  Phags_Pa: "Phag",
  Phoenician: "Phnx",
  Psalter_Pahlavi: "Phlp",
  Rejang: "Rjng",
  Runic: "Runr",
  Samaritan: "Samr",
  Saurashtra: "Saur",
  Sharada: "Shrd",
  Shavian: "Shaw",
  Siddham: "Sidd",
  SignWriting: "Sgnw",
  Sinhala: "Sinh",
  Sogdian: "Sogd",
  Sora_Sompeng: "Sora",
  Soyombo: "Soyo",
  Sundanese: "Sund",
  Syloti_Nagri: "Sylo",
  Syriac: "Syrc",
  Tagalog: "Tglg",
  Tagbanwa: "Tagb",
  Tai_Le: "Tale",
  Tai_Tham: "Lana",
  Tai_Viet: "Tavt",
  Takri: "Takr",
  Tamil: "Taml",
  Tangut: "Tang",
  Telugu: "Telu",
  Thaana: "Thaa",
  Thai: "Thai",
  Tibetan: "Tibt",
  Tifinagh: "Tfng",
  Tirhuta: "Tirh",
  Ugaritic: "Ugar",
  Vai: "Vaii",
  Warang_Citi: "Wara",
  Yi: "Yiii",
  Zanabazar_Square: "Zanb"
};
var SCRIPT_VALUE_ALIASES_TO_VALUES = inverseMap(SCRIPT_VALUE_TO_ALIASES);
function inverseMap(data) {
  const inverse = {};
  for (const name of Object.keys(data)) {
    const value3 = data[name];
    if (Array.isArray(value3))
      for (let i = 0;i !== value3.length; ++i)
        inverse[value3[i]] = name;
    else
      inverse[value3] = name;
  }
  return inverse;
}
function isGeneralCategoryValue(value3) {
  return value3 in GENERAL_CATEGORY_VALUE_TO_ALIASES || value3 in GENERAL_CATEGORY_VALUE_ALIASES_TO_VALUES;
}
function isBinaryPropertyName(name) {
  return name in BINARY_PROP_NAMES_TO_ALIASES || name in BINARY_ALIASES_TO_PROP_NAMES;
}
function getCanonicalName(name) {
  if (name in NON_BINARY_ALIASES_TO_PROP_NAMES)
    return NON_BINARY_ALIASES_TO_PROP_NAMES[name];
  if (name in BINARY_ALIASES_TO_PROP_NAMES)
    return BINARY_ALIASES_TO_PROP_NAMES[name];
  if (name in BINARY_PROP_NAMES_TO_ALIASES || name === "General_Category" || name === "Script" || name === "Script_Extensions")
    return name;
  throw new Error(`Unknown Unicode property name: ${name}`);
}
function getCanonicalValue(value3) {
  if (value3 in GENERAL_CATEGORY_VALUE_ALIASES_TO_VALUES)
    return GENERAL_CATEGORY_VALUE_ALIASES_TO_VALUES[value3];
  if (value3 in SCRIPT_VALUE_ALIASES_TO_VALUES)
    return SCRIPT_VALUE_ALIASES_TO_VALUES[value3];
  if (value3 in BINARY_ALIASES_TO_PROP_NAMES)
    return BINARY_ALIASES_TO_PROP_NAMES[value3];
  if (value3 in GENERAL_CATEGORY_VALUE_TO_ALIASES || value3 in SCRIPT_VALUE_TO_ALIASES || value3 in BINARY_PROP_NAMES_TO_ALIASES)
    return value3;
  throw new Error(`Unknown Unicode property value: ${value3}`);
}
function resolveUnicodeProperty(propertySpec, negative) {
  const equalIndex = propertySpec.indexOf("=");
  if (equalIndex !== -1) {
    const name = propertySpec.substring(0, equalIndex);
    const value3 = propertySpec.substring(equalIndex + 1);
    return {
      type: "UnicodeProperty",
      name,
      value: value3,
      negative,
      shorthand: false,
      binary: false,
      canonicalName: getCanonicalName(name),
      canonicalValue: getCanonicalValue(value3)
    };
  }
  if (isGeneralCategoryValue(propertySpec))
    return {
      type: "UnicodeProperty",
      name: "General_Category",
      value: propertySpec,
      negative,
      shorthand: true,
      binary: false,
      canonicalName: "General_Category",
      canonicalValue: getCanonicalValue(propertySpec)
    };
  if (isBinaryPropertyName(propertySpec)) {
    const canonicalName = getCanonicalName(propertySpec);
    return {
      type: "UnicodeProperty",
      name: propertySpec,
      value: propertySpec,
      negative,
      shorthand: false,
      binary: true,
      canonicalName,
      canonicalValue: canonicalName
    };
  }
  throw new Error(`Invalid Unicode property: ${propertySpec}`);
}
var safeStringFromCodePoint$2 = String.fromCodePoint;
function safePop(tokens) {
  const previous = tokens.pop();
  if (previous === undefined)
    throw new Error("Unable to extract token preceeding the currently parsed one");
  return previous;
}
function isDigit(char) {
  return char >= "0" && char <= "9";
}
function simpleChar(char, escaped) {
  return {
    type: "Char",
    kind: "simple",
    symbol: char,
    value: char,
    codePoint: char.codePointAt(0) || -1,
    escaped
  };
}
function metaEscapedChar(block, symbol4) {
  return {
    type: "Char",
    kind: "meta",
    symbol: symbol4,
    value: block,
    codePoint: symbol4.codePointAt(0) || -1
  };
}
function toSingleToken(tokens, allowEmpty) {
  if (tokens.length > 1)
    return {
      type: "Alternative",
      expressions: tokens
    };
  if (!allowEmpty && tokens.length === 0)
    throw new Error(`Unsupported no token`);
  return tokens[0];
}
function blockToCharToken(block) {
  if (block[0] === "\\") {
    const next = block[1];
    switch (next) {
      case "x": {
        const allDigits = block.substring(2);
        const codePoint = Number.parseInt(allDigits, 16);
        return {
          type: "Char",
          kind: "hex",
          symbol: safeStringFromCodePoint$2(codePoint),
          value: block,
          codePoint
        };
      }
      case "u": {
        if (block === "\\u")
          return simpleChar("u", true);
        const allDigits = block[2] === "{" ? block.substring(3, block.length - 1) : block.substring(2);
        const codePoint = Number.parseInt(allDigits, 16);
        return {
          type: "Char",
          kind: "unicode",
          symbol: safeStringFromCodePoint$2(codePoint),
          value: block,
          codePoint
        };
      }
      case "0":
        return metaEscapedChar(block, "\x00");
      case "n":
        return metaEscapedChar(block, `
`);
      case "f":
        return metaEscapedChar(block, "\f");
      case "r":
        return metaEscapedChar(block, "\r");
      case "t":
        return metaEscapedChar(block, "\t");
      case "v":
        return metaEscapedChar(block, "\v");
      case "w":
      case "W":
      case "d":
      case "D":
      case "s":
      case "S":
      case "b":
      case "B":
        return {
          type: "Char",
          kind: "meta",
          symbol: undefined,
          value: block,
          codePoint: NaN
        };
      default:
        if (isDigit(next)) {
          const allDigits = block.substring(1);
          const codePoint = Number(allDigits);
          return {
            type: "Char",
            kind: "decimal",
            symbol: safeStringFromCodePoint$2(codePoint),
            value: block,
            codePoint
          };
        }
        if (block.length > 2 && (next === "p" || next === "P")) {
          const negative = next === "P";
          return resolveUnicodeProperty(block.substring(3, block.length - 1), negative);
        }
        return simpleChar(block.substring(1), true);
    }
  }
  return simpleChar(block);
}
function pushTokens(tokens, regexSource, unicodeMode, groups) {
  let disjunctions = null;
  for (let index2 = 0, block = readFrom(regexSource, index2, unicodeMode, 0);index2 !== regexSource.length; index2 += block.length, block = readFrom(regexSource, index2, unicodeMode, 0)) {
    const firstInBlock = block[0];
    switch (firstInBlock) {
      case "|":
        if (disjunctions === null)
          disjunctions = [];
        disjunctions.push(toSingleToken(tokens.splice(0), true) || null);
        break;
      case ".":
        tokens.push({
          type: "Char",
          kind: "meta",
          symbol: block,
          value: block,
          codePoint: NaN
        });
        break;
      case "*":
      case "+": {
        const previous = safePop(tokens);
        tokens.push({
          type: "Repetition",
          expression: previous,
          quantifier: {
            type: "Quantifier",
            kind: firstInBlock,
            greedy: true
          }
        });
        break;
      }
      case "?": {
        const previous = safePop(tokens);
        if (previous.type === "Repetition") {
          previous.quantifier.greedy = false;
          tokens.push(previous);
        } else
          tokens.push({
            type: "Repetition",
            expression: previous,
            quantifier: {
              type: "Quantifier",
              kind: firstInBlock,
              greedy: true
            }
          });
        break;
      }
      case "{": {
        if (block === "{") {
          tokens.push(simpleChar(block));
          break;
        }
        const previous = safePop(tokens);
        const quantifierTokens = block.substring(1, block.length - 1).split(",");
        const from = Number(quantifierTokens[0]);
        const to = quantifierTokens.length === 1 ? from : quantifierTokens[1].length !== 0 ? Number(quantifierTokens[1]) : undefined;
        tokens.push({
          type: "Repetition",
          expression: previous,
          quantifier: {
            type: "Quantifier",
            kind: "Range",
            greedy: true,
            from,
            to
          }
        });
        break;
      }
      case "[": {
        const blockContent = block.substring(1, block.length - 1);
        const subTokens = [];
        let negative = undefined;
        let previousWasSimpleDash = false;
        for (let subIndex = 0, subBlock = readFrom(blockContent, subIndex, unicodeMode, 1);subIndex !== blockContent.length; subIndex += subBlock.length, subBlock = readFrom(blockContent, subIndex, unicodeMode, 1)) {
          if (subIndex === 0 && subBlock === "^") {
            negative = true;
            continue;
          }
          const newToken = blockToCharToken(subBlock);
          if (subBlock === "-") {
            subTokens.push(newToken);
            previousWasSimpleDash = true;
          } else {
            const operand1Token = subTokens.length >= 2 ? subTokens[subTokens.length - 2] : undefined;
            if (previousWasSimpleDash && operand1Token !== undefined && operand1Token.type === "Char" && newToken.type === "Char") {
              subTokens.pop();
              subTokens.pop();
              subTokens.push({
                type: "ClassRange",
                from: operand1Token,
                to: newToken
              });
            } else
              subTokens.push(newToken);
            previousWasSimpleDash = false;
          }
        }
        tokens.push({
          type: "CharacterClass",
          expressions: subTokens,
          negative
        });
        break;
      }
      case "(": {
        const blockContent = block.substring(1, block.length - 1);
        const subTokens = [];
        if (blockContent[0] === "?")
          if (blockContent[1] === ":") {
            pushTokens(subTokens, blockContent.substring(2), unicodeMode, groups);
            tokens.push({
              type: "Group",
              capturing: false,
              expression: toSingleToken(subTokens)
            });
          } else if (blockContent[1] === "=" || blockContent[1] === "!") {
            pushTokens(subTokens, blockContent.substring(2), unicodeMode, groups);
            tokens.push({
              type: "Assertion",
              kind: "Lookahead",
              negative: blockContent[1] === "!" ? true : undefined,
              assertion: toSingleToken(subTokens)
            });
          } else if (blockContent[1] === "<" && (blockContent[2] === "=" || blockContent[2] === "!")) {
            pushTokens(subTokens, blockContent.substring(3), unicodeMode, groups);
            tokens.push({
              type: "Assertion",
              kind: "Lookbehind",
              negative: blockContent[2] === "!" ? true : undefined,
              assertion: toSingleToken(subTokens)
            });
          } else {
            const chunks = blockContent.split(">");
            if (chunks.length < 2 || chunks[0][1] !== "<")
              throw new Error(`Unsupported regex content found at ${JSON.stringify(block)}`);
            const groupIndex = ++groups.lastIndex;
            const nameRaw = chunks[0].substring(2);
            groups.named.set(nameRaw, groupIndex);
            pushTokens(subTokens, chunks.slice(1).join(">"), unicodeMode, groups);
            tokens.push({
              type: "Group",
              capturing: true,
              nameRaw,
              name: nameRaw,
              number: groupIndex,
              expression: toSingleToken(subTokens)
            });
          }
        else {
          const groupIndex = ++groups.lastIndex;
          pushTokens(subTokens, blockContent, unicodeMode, groups);
          tokens.push({
            type: "Group",
            capturing: true,
            number: groupIndex,
            expression: toSingleToken(subTokens)
          });
        }
        break;
      }
      default:
        if (block === "^")
          tokens.push({
            type: "Assertion",
            kind: block
          });
        else if (block === "$")
          tokens.push({
            type: "Assertion",
            kind: block
          });
        else if (block[0] === "\\" && isDigit(block[1])) {
          const reference = Number(block.substring(1));
          if (unicodeMode || reference <= groups.lastIndex)
            tokens.push({
              type: "Backreference",
              kind: "number",
              number: reference,
              reference
            });
          else
            tokens.push(blockToCharToken(block));
        } else if (block[0] === "\\" && block[1] === "k" && block.length !== 2) {
          const referenceRaw = block.substring(3, block.length - 1);
          tokens.push({
            type: "Backreference",
            kind: "name",
            number: groups.named.get(referenceRaw) || 0,
            referenceRaw,
            reference: referenceRaw
          });
        } else
          tokens.push(blockToCharToken(block));
        break;
    }
  }
  if (disjunctions !== null) {
    disjunctions.push(toSingleToken(tokens.splice(0), true) || null);
    let currentDisjunction = {
      type: "Disjunction",
      left: disjunctions[0],
      right: disjunctions[1]
    };
    for (let index2 = 2;index2 < disjunctions.length; ++index2)
      currentDisjunction = {
        type: "Disjunction",
        left: currentDisjunction,
        right: disjunctions[index2]
      };
    tokens.push(currentDisjunction);
  }
}
function tokenizeRegex(regex) {
  const unicodeMode = safeIndexOf([...regex.flags], "u") !== -1;
  const regexSource = regex.source;
  const tokens = [];
  pushTokens(tokens, regexSource, unicodeMode, {
    lastIndex: 0,
    named: /* @__PURE__ */ new Map
  });
  return toSingleToken(tokens);
}
var safeStringFromCodePoint$1 = String.fromCodePoint;
function getPropertySpec(astNode) {
  if (astNode.binary || astNode.shorthand)
    return astNode.canonicalValue;
  return `${astNode.canonicalName}=${astNode.canonicalValue}`;
}
function appendRangesForRegex(regex, from, to, ranges) {
  let currentRangeStart = -1;
  for (let cp = from;cp <= to; ++cp)
    if (regex.test(safeStringFromCodePoint$1(cp))) {
      if (currentRangeStart === -1)
        currentRangeStart = cp;
    } else if (currentRangeStart !== -1) {
      const rangeEnd = cp - 1;
      ranges.push(currentRangeStart === rangeEnd ? [rangeEnd] : [currentRangeStart, rangeEnd]);
      currentRangeStart = -1;
    }
  if (currentRangeStart !== -1)
    ranges.push(currentRangeStart === to ? [to] : [currentRangeStart, to]);
}
function extractRangesForProperty(propertySpec, negative) {
  const regex = new RegExp(`^\\${negative ? "P" : "p"}{${propertySpec}}$`, "u");
  const ranges = [];
  appendRangesForRegex(regex, 0, 55295, ranges);
  appendRangesForRegex(regex, 57344, 1114111, ranges);
  return ranges;
}
var cache = /* @__PURE__ */ new Map;
function extractRangesForPropertyOrFromCache(propertySpec, negative) {
  const cacheKey = `${negative ? "P" : "p"}:${propertySpec}`;
  const cachedRanges = cache.get(cacheKey);
  if (cachedRanges !== undefined)
    return cachedRanges;
  const ranges = extractRangesForProperty(propertySpec, negative);
  cache.set(cacheKey, ranges);
  return ranges;
}
function unicodePropertyArbitrary(astNode) {
  return mapToConstant(...safeMap(extractRangesForPropertyOrFromCache(getPropertySpec(astNode), astNode.negative), (range) => convertGraphemeRangeToMapToConstantEntry(range)));
}
var safeStringFromCodePoint = String.fromCodePoint;
var wordChars = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"];
var digitChars = [..."0123456789"];
var spaceChars = [...` 	\r
\v\f`];
var newLineChars = [...`\r
`];
var terminatorChars = [..."\x1E\x15"];
var newLineAndTerminatorChars = [...newLineChars, ...terminatorChars];
var defaultChar = () => string3({
  unit: "grapheme-ascii",
  minLength: 1,
  maxLength: 1
});
function raiseUnsupportedASTNode(astNode) {
  return new SError(`Unsupported AST node! Received: ${stringify(astNode)}`);
}
function toMatchingArbitrary(astNode, constraints, flags) {
  switch (astNode.type) {
    case "Char":
      if (astNode.kind === "meta")
        switch (astNode.value) {
          case "\\w":
            return constantFrom(...wordChars);
          case "\\W":
            return defaultChar().filter((c) => safeIndexOf(wordChars, c) === -1);
          case "\\d":
            return constantFrom(...digitChars);
          case "\\D":
            return defaultChar().filter((c) => safeIndexOf(digitChars, c) === -1);
          case "\\s":
            return constantFrom(...spaceChars);
          case "\\S":
            return defaultChar().filter((c) => safeIndexOf(spaceChars, c) === -1);
          case "\\b":
          case "\\B":
            throw new SError(`Meta character ${astNode.value} not implemented yet!`);
          case ".": {
            const forbiddenChars = flags.dotAll ? terminatorChars : newLineAndTerminatorChars;
            return defaultChar().filter((c) => safeIndexOf(forbiddenChars, c) === -1);
          }
        }
      if (astNode.symbol === undefined)
        throw new SError(`Unexpected undefined symbol received for non-meta Char! Received: ${stringify(astNode)}`);
      return constant2(astNode.symbol);
    case "Repetition": {
      const node = toMatchingArbitrary(astNode.expression, constraints, flags);
      switch (astNode.quantifier.kind) {
        case "*":
          return string3({
            ...constraints,
            unit: node
          });
        case "+":
          return string3({
            ...constraints,
            minLength: 1,
            unit: node
          });
        case "?":
          return string3({
            ...constraints,
            minLength: 0,
            maxLength: 1,
            unit: node
          });
        case "Range":
          return string3({
            ...constraints,
            minLength: astNode.quantifier.from,
            maxLength: astNode.quantifier.to,
            unit: node
          });
        default:
          throw raiseUnsupportedASTNode(astNode.quantifier);
      }
    }
    case "Quantifier":
      throw new SError(`Wrongly defined AST tree, Quantifier nodes not supposed to be scanned!`);
    case "Alternative":
      return tuple2(...safeMap(astNode.expressions, (n) => toMatchingArbitrary(n, constraints, flags))).map((vs) => safeJoin(vs, ""));
    case "CharacterClass":
      if (astNode.negative) {
        const childrenArbitraries = safeMap(astNode.expressions, (n) => toMatchingArbitrary(n, constraints, flags));
        return defaultChar().filter((c) => safeEvery(childrenArbitraries, (arb) => !arb.canShrinkWithoutContext(c)));
      }
      return oneof(...safeMap(astNode.expressions, (n) => toMatchingArbitrary(n, constraints, flags)));
    case "ClassRange": {
      const min4 = astNode.from.codePoint;
      const max4 = astNode.to.codePoint;
      return integer({
        min: min4,
        max: max4
      }).map((n) => safeStringFromCodePoint(n), (c) => {
        if (typeof c !== "string")
          throw new SError("Invalid type");
        if ([...c].length !== 1)
          throw new SError("Invalid length");
        return safeCharCodeAt(c, 0);
      });
    }
    case "Group":
      return toMatchingArbitrary(astNode.expression, constraints, flags);
    case "Disjunction":
      return oneof(astNode.left !== null ? toMatchingArbitrary(astNode.left, constraints, flags) : constant2(""), astNode.right !== null ? toMatchingArbitrary(astNode.right, constraints, flags) : constant2(""));
    case "Assertion":
      if (astNode.kind === "^" || astNode.kind === "$") {
        if (flags.multiline)
          if (astNode.kind === "^")
            return oneof(constant2(""), tuple2(string3({ unit: defaultChar() }), constantFrom(...newLineChars)).map((t) => `${t[0]}${t[1]}`, (value3) => {
              if (typeof value3 !== "string" || value3.length === 0)
                throw new SError("Invalid type");
              return [safeSubstring(value3, 0, value3.length - 1), value3[value3.length - 1]];
            }));
          else
            return oneof(constant2(""), tuple2(constantFrom(...newLineChars), string3({ unit: defaultChar() })).map((t) => `${t[0]}${t[1]}`, (value3) => {
              if (typeof value3 !== "string" || value3.length === 0)
                throw new SError("Invalid type");
              return [value3[0], safeSubstring(value3, 1)];
            }));
        return constant2("");
      }
      throw new SError(`Assertions of kind ${astNode.kind} not implemented yet!`);
    case "Backreference":
      throw new SError(`Backreference nodes not implemented yet!`);
    case "UnicodeProperty":
      return unicodePropertyArbitrary(astNode);
    default:
      throw raiseUnsupportedASTNode(astNode);
  }
}
function stringMatching(regex, constraints = {}) {
  for (const flag of regex.flags)
    if (flag !== "d" && flag !== "g" && flag !== "m" && flag !== "s" && flag !== "u")
      throw new SError(`Unable to use "stringMatching" against a regex using the flag ${flag}`);
  const maxLength = constraints.maxLength;
  const sanitizedConstraints = {
    size: constraints.size,
    maxLength
  };
  const flags = {
    multiline: regex.multiline,
    dotAll: regex.dotAll
  };
  let regexRootToken = addMissingDotStar(tokenizeRegex(regex));
  if (maxLength !== undefined)
    regexRootToken = clampRegexAst(regexRootToken, maxLength);
  const baseArbitrary = toMatchingArbitrary(regexRootToken, sanitizedConstraints, flags);
  if (maxLength !== undefined)
    return baseArbitrary.filter((s) => [...s].length <= maxLength);
  return baseArbitrary;
}
function initZippedValues(its) {
  const vs = [];
  for (let index2 = 0;index2 !== its.length; ++index2)
    vs.push(its[index2].next());
  return vs;
}
function nextZippedValues(its, vs) {
  for (let index2 = 0;index2 !== its.length; ++index2)
    vs[index2] = its[index2].next();
}
function isDoneZippedValues(vs) {
  for (let index2 = 0;index2 !== vs.length; ++index2)
    if (vs[index2].done)
      return true;
  return false;
}
function* zipIterableIterators(...its) {
  const vs = initZippedValues(its);
  while (!isDoneZippedValues(vs)) {
    yield vs.map((v) => v.value);
    nextZippedValues(its, vs);
  }
}
function* iotaFrom(startValue) {
  let value3 = startValue;
  while (true) {
    yield value3;
    ++value3;
  }
}
var LimitedShrinkArbitrary = class extends Arbitrary {
  constructor(arb, maxShrinks) {
    super();
    this.arb = arb;
    this.maxShrinks = maxShrinks;
  }
  generate(mrng, biasFactor) {
    const value3 = this.arb.generate(mrng, biasFactor);
    return this.valueMapper(value3, 0);
  }
  canShrinkWithoutContext(value3) {
    return this.arb.canShrinkWithoutContext(value3);
  }
  shrink(value3, context3) {
    if (this.isSafeContext(context3))
      return this.safeShrink(value3, context3.originalContext, context3.length);
    return this.safeShrink(value3, undefined, 0);
  }
  safeShrink(value3, originalContext, currentLength) {
    const remaining = this.maxShrinks - currentLength;
    if (remaining <= 0)
      return Stream.nil();
    return new Stream(zipIterableIterators(this.arb.shrink(value3, originalContext), iotaFrom(currentLength + 1))).take(remaining).map((valueAndLength) => this.valueMapper(valueAndLength[0], valueAndLength[1]));
  }
  valueMapper(v, newLength) {
    const context3 = {
      originalContext: v.context,
      length: newLength
    };
    return new Value(v.value, context3);
  }
  isSafeContext(context3) {
    return context3 !== null && context3 !== undefined && typeof context3 === "object" && "originalContext" in context3 && "length" in context3;
  }
};
function limitShrink(arbitrary, maxShrinks) {
  return new LimitedShrinkArbitrary(arbitrary, maxShrinks);
}
var __type = "module";
var __version = "4.8.0";
var __commitHash = "c0da76fbcf6470339ad7bb2f0dfcebee06ede56c";
// ../../node_modules/.bun/effect@4.0.0-beta.92/node_modules/effect/dist/Schema.js
var TypeId13 = TypeId12;
function declareConstructor() {
  return (typeParameters, run2, annotations) => {
    return make18(new Declaration(typeParameters.map(getAST), (typeParameters2) => run2(typeParameters2.map((ast) => make18(ast))), annotations));
  };
}
function declare(is2, annotations) {
  return declareConstructor()([], () => (input, ast) => is2(input) ? succeed5(input) : fail5(new InvalidType(ast, some2(input))), annotations);
}
function revealBottom(bottom) {
  return bottom;
}
function annotate2(annotations) {
  return (self) => self.annotate(annotations);
}
function annotateEncoded(annotations) {
  return (self) => flip3(flip3(self).annotate(annotations));
}
function annotateKey2(annotations) {
  return (self) => {
    return self.rebuild(annotateKey(self.ast, annotations));
  };
}
function revealCodec(codec) {
  return codec;
}
function isSchemaError(u) {
  return hasProperty(u, SchemaErrorTypeId);
}
function makeStandardResult(exit3) {
  return isSuccess3(exit3) ? exit3.value : {
    issues: [{
      message: pretty(exit3.cause)
    }]
  };
}
function toStandardSchemaV1(self, options) {
  const decodeUnknownEffect2 = decodeUnknownEffect(self);
  const parseOptions = {
    errors: "all",
    ...options?.parseOptions
  };
  const formatter = makeFormatterStandardSchemaV1(options);
  const validate2 = (value3) => {
    const scheduler2 = new MixedScheduler;
    const fiber2 = runFork2(match5(decodeUnknownEffect2(value3, parseOptions), {
      onFailure: formatter,
      onSuccess: (value4) => ({
        value: value4
      })
    }), {
      scheduler: scheduler2
    });
    fiber2.currentDispatcher?.flush();
    const exit3 = fiber2.pollUnsafe();
    if (exit3) {
      return makeStandardResult(exit3);
    }
    return new Promise((resolve2) => {
      fiber2.addObserver((exit4) => {
        resolve2(makeStandardResult(exit4));
      });
    });
  };
  if ("~standard" in self) {
    const out = self;
    if ("validate" in out["~standard"])
      return out;
    Object.assign(out["~standard"], {
      validate: validate2
    });
    return out;
  } else {
    return Object.assign(self, {
      "~standard": {
        version: 1,
        vendor: "effect",
        validate: validate2
      }
    });
  }
}
function toBaseStandardJSONSchemaV1(self, target) {
  const doc2020_12 = toJsonSchemaDocument2(self);
  if (target === "draft-2020-12") {
    const schema = doc2020_12.schema;
    if (Object.keys(doc2020_12.definitions).length > 0) {
      schema.$defs = doc2020_12.definitions;
    }
    return schema;
  } else if (target === "draft-07") {
    const doc07 = toDocumentDraft07(doc2020_12);
    const schema = doc07.schema;
    if (Object.keys(doc07.definitions).length > 0) {
      schema.definitions = doc07.definitions;
    }
    return schema;
  }
  throw new globalThis.Error(`Unsupported target: ${target}`);
}
function toStandardJSONSchemaV1(self) {
  const jsonSchema = {
    input(options) {
      return toBaseStandardJSONSchemaV1(self, options.target);
    },
    output(options) {
      return toBaseStandardJSONSchemaV1(toType2(self), options.target);
    }
  };
  if ("~standard" in self) {
    const out = self;
    if ("jsonSchema" in out["~standard"])
      return out;
    Object.assign(out["~standard"], {
      jsonSchema
    });
    return out;
  } else {
    return Object.assign(self, {
      "~standard": {
        version: 1,
        vendor: "effect",
        jsonSchema
      }
    });
  }
}
var is2 = is;
var asserts2 = asserts;
function decodeUnknownEffect2(schema, options) {
  const parser = decodeUnknownEffect(schema, options);
  return (input, options2) => {
    return mapSchemaIssueEffect2(parser(input, options2));
  };
}
var decodeEffect2 = decodeUnknownEffect2;
function getSchemaErrorOrThrow(cause, message) {
  let schemaError;
  for (const reason of cause.reasons) {
    if (!isFailReason2(reason) || !isSchemaError(reason.error)) {
      throw new globalThis.Error(message, {
        cause
      });
    }
    schemaError ??= reason.error;
  }
  if (schemaError === undefined) {
    throw new globalThis.Error(message, {
      cause
    });
  }
  return schemaError;
}
function runSchemaErrorPromise(self) {
  return runPromiseExit2(self).then((exit3) => {
    if (isSuccess3(exit3)) {
      return exit3.value;
    }
    throw getSchemaErrorOrThrow(exit3.cause, "Promise adapter can only reject schema errors");
  });
}
function runSchemaErrorSync(self) {
  const exit3 = runSyncExit2(self);
  if (isSuccess3(exit3)) {
    return exit3.value;
  }
  throw getSchemaErrorOrThrow(exit3.cause, "Sync adapter can only throw schema errors");
}
function decodeUnknownExit2(schema, options) {
  const parser = decodeUnknownExit(schema, options);
  return (input, options2) => {
    return mapSchemaIssueExit(parser(input, options2));
  };
}
var decodeExit = decodeUnknownExit2;
var decodeUnknownOption2 = decodeUnknownOption;
var decodeOption2 = decodeOption;
function decodeUnknownResult2(schema, options) {
  const parser = decodeUnknownResult(schema, options);
  return (input, options2) => {
    return mapError(parser(input, options2), (issue) => new SchemaError(issue));
  };
}
var decodeResult = decodeUnknownResult2;
function decodeUnknownPromise(schema, options) {
  const parser = decodeUnknownEffect2(schema, options);
  return (input, options2) => {
    return runSchemaErrorPromise(parser(input, options2));
  };
}
var decodePromise = decodeUnknownPromise;
function decodeUnknownSync2(schema, options) {
  const parser = decodeUnknownEffect2(schema, options);
  return (input, options2) => {
    return runSchemaErrorSync(parser(input, options2));
  };
}
var decodeSync2 = decodeUnknownSync2;
function encodeUnknownEffect2(schema, options) {
  const parser = encodeUnknownEffect(schema, options);
  return (input, options2) => {
    return mapSchemaIssueEffect2(parser(input, options2));
  };
}
var encodeEffect = encodeUnknownEffect2;
function encodeUnknownExit2(schema, options) {
  const parser = encodeUnknownExit(schema, options);
  return (input, options2) => {
    return mapSchemaIssueExit(parser(input, options2));
  };
}
var encodeExit = encodeUnknownExit2;
var encodeUnknownOption2 = encodeUnknownOption;
var encodeOption2 = encodeOption;
function encodeUnknownResult2(schema, options) {
  const parser = encodeUnknownResult(schema, options);
  return (input, options2) => {
    return mapError(parser(input, options2), (issue) => new SchemaError(issue));
  };
}
var encodeResult = encodeUnknownResult2;
function encodeUnknownPromise(schema, options) {
  const parser = encodeUnknownEffect2(schema, options);
  return (input, options2) => {
    return runSchemaErrorPromise(parser(input, options2));
  };
}
var encodePromise = encodeUnknownPromise;
function encodeUnknownSync2(schema, options) {
  const parser = encodeUnknownEffect2(schema, options);
  return (input, options2) => {
    return runSchemaErrorSync(parser(input, options2));
  };
}
var encodeSync2 = encodeUnknownSync2;
var make18 = make16;
function asClass(schema) {

  class Class3 {
  }
  return Object.setPrototypeOf(Class3, schema);
}
function isSchema(u) {
  return hasProperty(u, TypeId13) && u[TypeId13] === TypeId13;
}
var optionalKey2 = /* @__PURE__ */ lambda((schema) => make18(optionalKey(schema.ast), {
  schema
}));
var requiredKey = /* @__PURE__ */ lambda((self) => self.schema);
var optional = /* @__PURE__ */ lambda((self) => optionalKey2(UndefinedOr(self)));
var required = /* @__PURE__ */ lambda((self) => self.schema.members[0]);
var mutableKey2 = /* @__PURE__ */ lambda((schema) => make18(mutableKey(schema.ast), {
  schema
}));
var readonlyKey = /* @__PURE__ */ lambda((self) => self.schema);
var toType2 = /* @__PURE__ */ lambda((schema) => make18(toType(schema.ast), {
  schema
}));
var toEncoded2 = /* @__PURE__ */ lambda((schema) => make18(toEncoded(schema.ast), {
  schema
}));
var FlipTypeId = "~effect/Schema/flip";
function isFlip$(schema) {
  return hasProperty(schema, FlipTypeId) && schema[FlipTypeId] === FlipTypeId;
}
function flip3(schema) {
  if (isFlip$(schema)) {
    return schema.schema.rebuild(flip2(schema.ast));
  }
  return make18(flip2(schema.ast), {
    [FlipTypeId]: FlipTypeId,
    schema
  });
}
function Literal2(literal) {
  const out = make18(new Literal(literal), {
    literal,
    transform(to) {
      return out.pipe(decodeTo2(Literal2(to), {
        decode: transform(() => to),
        encode: transform(() => literal)
      }));
    }
  });
  return out;
}
function templateLiteralFromParts(parts) {
  return new TemplateLiteral(parts.map((part) => isSchema(part) ? part.ast : new Literal(part)));
}
function TemplateLiteral2(parts) {
  return make18(templateLiteralFromParts(parts), {
    parts
  });
}
function TemplateLiteralParser(parts) {
  return make18(templateLiteralFromParts(parts).asTemplateLiteralParser(), {
    parts
  });
}
function Enum2(enums) {
  return make18(new Enum(Object.keys(enums).filter((key) => typeof enums[enums[key]] !== "number").map((key) => [key, enums[key]])), {
    enums
  });
}
var Never2 = /* @__PURE__ */ make18(never2);
var Any2 = /* @__PURE__ */ make18(any);
var Unknown2 = /* @__PURE__ */ make18(unknown);
var Null2 = /* @__PURE__ */ make18(null_);
var Undefined2 = /* @__PURE__ */ make18(undefined_2);
var String5 = /* @__PURE__ */ make18(string2);
var Number6 = /* @__PURE__ */ make18(number2);
var Boolean4 = /* @__PURE__ */ make18(boolean);
var Symbol3 = /* @__PURE__ */ make18(symbol3);
var BigInt5 = /* @__PURE__ */ make18(bigInt);
var Void2 = /* @__PURE__ */ make18(void_4);
var ObjectKeyword2 = /* @__PURE__ */ make18(objectKeyword);
function UniqueSymbol2(symbol4) {
  return make18(new UniqueSymbol(symbol4));
}
function makeStruct(ast, fields) {
  return make18(ast, {
    fields,
    mapFields(f, options) {
      const fields2 = f(this.fields);
      return makeStruct(struct(fields2, options?.unsafePreserveChecks ? this.ast.checks : undefined), fields2);
    }
  });
}
function Struct(fields) {
  return makeStruct(struct(fields, undefined), fields);
}
function fieldsAssign(fields) {
  return lambda((struct2) => struct2.mapFields(assign(fields)));
}
var canonicalPropertyKey = (key) => typeof key === "symbol" ? key : globalThis.String(key);
function encodeKeys(mapping) {
  return function(self) {
    const fields = {};
    const appliedMapping = {};
    const reverseMapping = {};
    const seenEncodedKeys = new Set;
    for (const k of Reflect.ownKeys(self.fields)) {
      const encoded = toEncoded2(self.fields[k]);
      const hasMapping = Object.hasOwn(mapping, k);
      const encodedKey = hasMapping ? mapping[k] : k;
      const canonical = canonicalPropertyKey(encodedKey);
      if (seenEncodedKeys.has(canonical)) {
        throw new globalThis.Error(`Duplicate encoded keys: ${formatPropertyKey(encodedKey)}`);
      }
      seenEncodedKeys.add(canonical);
      fields[encodedKey] = encoded;
      if (hasMapping) {
        appliedMapping[k] = encodedKey;
        reverseMapping[encodedKey] = k;
      }
    }
    return Struct(fields).pipe(decodeTo2(self, transform2({
      decode: renameKeys(reverseMapping),
      encode: renameKeys(appliedMapping)
    })));
  };
}
function extendTo(fields, derive) {
  return (self) => {
    const f = map3(self.fields, toType2);
    const to = Struct({
      ...f,
      ...fields
    });
    return self.pipe(decodeTo2(to, transform2({
      decode: (input) => {
        const out = {
          ...input
        };
        for (const k in fields) {
          const f2 = derive[k];
          const o = f2(input);
          if (isSome2(o)) {
            out[k] = o.value;
          }
        }
        return out;
      },
      encode: (input) => {
        const out = {
          ...input
        };
        for (const k in fields) {
          delete out[k];
        }
        return out;
      }
    })));
  };
}
function Record(key, value3, options) {
  const keyValueCombiner = options?.keyValueCombiner?.decode || options?.keyValueCombiner?.encode ? new KeyValueCombiner(options.keyValueCombiner.decode, options.keyValueCombiner.encode) : undefined;
  return make18(record(key.ast, value3.ast, keyValueCombiner), {
    key,
    value: value3
  });
}
function StructWithRest(schema, records) {
  return make18(structWithRest(schema.ast, records.map(getAST)), {
    schema,
    records
  });
}
function makeTuple(ast, elements) {
  return make18(ast, {
    elements,
    mapElements(f, options) {
      const elements2 = f(this.elements);
      return makeTuple(tuple(elements2, options?.unsafePreserveChecks ? this.ast.checks : undefined), elements2);
    }
  });
}
function Tuple(elements) {
  return makeTuple(tuple(elements), elements);
}
function TupleWithRest(schema, rest) {
  return make18(tupleWithRest(schema.ast, rest.map(getAST)), {
    schema,
    rest
  });
}
var ArraySchema = /* @__PURE__ */ lambda((schema) => make18(new Arrays(false, [], [schema.ast]), {
  value: schema
}));
var NonEmptyArray = /* @__PURE__ */ lambda((schema) => make18(new Arrays(false, [schema.ast], [schema.ast]), {
  value: schema
}));
function ArrayEnsure(schema) {
  return Union2([schema, ArraySchema(schema)]).pipe(decodeTo2(ArraySchema(toType2(schema)), transform2({
    decode: ensure,
    encode: (array4) => array4.length === 1 ? array4[0] : array4
  })));
}
function UniqueArray(item) {
  return ArraySchema(item).check(isUnique());
}
var mutable = /* @__PURE__ */ lambda((schema) => {
  return make18(new Arrays(true, schema.ast.elements, schema.ast.rest), {
    schema
  });
});
function makeUnion(ast, members) {
  return make18(ast, {
    members,
    mapMembers(f, options) {
      const members2 = f(this.members);
      return makeUnion(union4(members2, this.ast.mode, options?.unsafePreserveChecks ? this.ast.checks : undefined), members2);
    }
  });
}
function Union2(members, options) {
  return makeUnion(union4(members, options?.mode ?? "anyOf", undefined), members);
}
function Literals(literals) {
  const members = literals.map(Literal2);
  return make18(union4(members, "anyOf", undefined), {
    literals,
    members,
    mapMembers(f) {
      return Union2(f(this.members));
    },
    pick(literals2) {
      return Literals(literals2);
    },
    transform(to) {
      return Union2(members.map((member, index2) => member.transform(to[index2])));
    }
  });
}
var NullOr = /* @__PURE__ */ lambda((self) => Union2([self, Null2]));
var UndefinedOr = /* @__PURE__ */ lambda((self) => Union2([self, Undefined2]));
var NullishOr = /* @__PURE__ */ lambda((self) => Union2([self, Null2, Undefined2]));
function suspend2(f) {
  return make18(new Suspend(() => f().ast));
}
function check2(...checks) {
  return (self) => self.check(...checks);
}
function refine(refinement, annotations) {
  return (schema) => make18(appendChecks(schema.ast, [makeFilterByGuard(refinement, annotations)]), {
    schema
  });
}
function brand2(identifier2) {
  return (schema) => make18(brand(schema.ast, identifier2), {
    schema,
    identifier: identifier2
  });
}
function fromBrand(identifier2, ctor) {
  return (self) => {
    return (ctor.checks ? self.check(...ctor.checks) : self).pipe(brand2(identifier2));
  };
}
function middlewareDecoding2(decode) {
  return (schema) => make18(middlewareDecoding(schema.ast, new Middleware(decode, identity)), {
    schema
  });
}
function middlewareEncoding2(encode) {
  return (schema) => make18(middlewareEncoding(schema.ast, new Middleware(identity, encode)), {
    schema
  });
}
function catchDecoding(f) {
  return catchDecodingWithContext(f);
}
function catchDecodingWithContext(f) {
  return (self) => middlewareDecoding2(catchEager2(f))(self);
}
function catchEncoding(f) {
  return catchEncodingWithContext(f);
}
function catchEncodingWithContext(f) {
  return (self) => middlewareEncoding2(catchEager2(f))(self);
}
function decodeTo2(to, transformation) {
  return (from) => {
    return make18(decodeTo(from.ast, to.ast, transformation ? make14(transformation) : passthrough2()), {
      from,
      to
    });
  };
}
function decode(transformation) {
  return (self) => {
    return decodeTo2(toType2(self), transformation)(self);
  };
}
function encodeTo(to, transformation) {
  return (from) => {
    return transformation ? decodeTo2(from, transformation)(to) : decodeTo2(from)(to);
  };
}
function encode(transformation) {
  return (self) => {
    return decodeTo2(self, transformation)(toEncoded2(self));
  };
}
function withConstructorDefault2(defaultValue) {
  return (schema) => make18(withConstructorDefault(schema.ast, mapSchemaErrorEffect(defaultValue)), {
    schema
  });
}
function withDecodingDefaultKey(defaultValue, options) {
  const encode2 = options?.encodingStrategy === "omit" ? omit() : passthrough();
  return (self) => {
    return optionalKey2(toEncoded2(self)).pipe(decodeTo2(self, {
      decode: withDefault(mapSchemaErrorEffect(defaultValue)),
      encode: encode2
    }));
  };
}
function withDecodingDefaultTypeKey(defaultValue, options) {
  return (self) => {
    return toType2(self).pipe(withDecodingDefaultKey(defaultValue, options), encodeTo(optionalKey2(self)));
  };
}
function withDecodingDefault(defaultValue, options) {
  const encode2 = options?.encodingStrategy === "omit" ? omit() : passthrough();
  return (self) => {
    return optional(toEncoded2(self)).pipe(decodeTo2(self, {
      decode: withDefault(mapSchemaErrorEffect(defaultValue)),
      encode: encode2
    }));
  };
}
function withDecodingDefaultType(defaultValue, options) {
  return (self) => {
    return toType2(self).pipe(withDecodingDefault(defaultValue, options), encodeTo(optional(self)));
  };
}
function tag(literal) {
  return Literal2(literal).pipe(withConstructorDefault2(succeed5(literal)));
}
function tagDefaultOmit(literal) {
  return tag(literal).pipe(withDecodingDefaultKey(succeed5(literal), {
    encodingStrategy: "omit"
  }));
}
function TaggedStruct(value3, fields) {
  return Struct({
    _tag: tag(value3),
    ...fields
  });
}
function toTaggedUnion(tag2) {
  return (self) => {
    const cases = {};
    const guards = {};
    const isAnyOf = (keys3) => (value3) => keys3.includes(value3[tag2]);
    walk(self);
    return Object.assign(self, {
      cases,
      isAnyOf,
      guards,
      match: match7
    });
    function walk(schema) {
      const ast = schema.ast;
      if (isUnion(ast) && "members" in schema && globalThis.Array.isArray(schema.members) && schema.members.every(isSchema)) {
        return schema.members.forEach(walk);
      }
      const sentinels = collectSentinels(ast);
      if (sentinels.length > 0) {
        const literal = sentinels.find((s) => s.key === tag2)?.literal;
        if (isPropertyKey(literal)) {
          cases[literal] = schema;
          guards[literal] = is2(toType2(schema));
          return;
        }
      }
      throw new globalThis.Error("No literal or unique symbol found");
    }
    function match7() {
      if (arguments.length === 1) {
        const cases3 = arguments[0];
        return function(value4) {
          return cases3[value4[tag2]](value4);
        };
      }
      const value3 = arguments[0];
      const cases2 = arguments[1];
      return cases2[value3[tag2]](value3);
    }
  };
}
function TaggedUnion(casesByTag) {
  const cases = {};
  const members = [];
  for (const key of Object.keys(casesByTag)) {
    members.push(cases[key] = TaggedStruct(key, casesByTag[key]));
  }
  const union5 = Union2(members);
  const {
    guards,
    isAnyOf,
    match: match7
  } = toTaggedUnion("_tag")(union5);
  return make18(union5.ast, {
    cases,
    isAnyOf,
    guards,
    match: match7
  });
}
function Opaque() {
  return (schema) => {

    class Opaque2 {
    }
    return Object.setPrototypeOf(Opaque2, schema);
  };
}
function instanceOf(constructor, annotations) {
  return declare((u) => u instanceof constructor, annotations);
}
function link() {
  return (encodeTo2, transformation) => {
    return new Link(encodeTo2.ast, make14(transformation));
  };
}
var makeFilter2 = makeFilter;
function makeFilterGroup(checks, annotations = undefined) {
  return new FilterGroup(checks, annotations);
}
var TRIMMED_PATTERN = "^\\S[\\s\\S]*\\S$|^\\S$|^$";
function isTrimmed(annotations) {
  return makeFilter2((s) => s.trim() === s, {
    expected: "a string with no leading or trailing whitespace",
    meta: {
      _tag: "isTrimmed",
      regExp: new globalThis.RegExp(TRIMMED_PATTERN)
    },
    arbitrary: {
      constraint: {
        patterns: [TRIMMED_PATTERN]
      }
    },
    ...annotations
  });
}
var isPattern2 = isPattern;
var isStringFinite2 = isStringFinite;
var isStringBigInt2 = isStringBigInt;
var isStringSymbol2 = isStringSymbol;
var getUUIDRegExp = (version2) => {
  if (version2) {
    return new globalThis.RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
  }
  return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$/;
};
function isUUID(version2, annotations) {
  const regExp = getUUIDRegExp(version2);
  return isPattern2(regExp, {
    expected: version2 ? `a UUID v${version2}` : "a UUID",
    meta: {
      _tag: "isUUID",
      regExp,
      version: version2
    },
    ...annotations
  });
}
var GUID_REGEXP = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
function isGUID(annotations) {
  return isPattern2(GUID_REGEXP, {
    expected: "a GUID",
    meta: {
      _tag: "isGUID",
      regExp: GUID_REGEXP
    },
    ...annotations
  });
}
function isULID(annotations) {
  const regExp = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
  return isPattern2(regExp, {
    meta: {
      _tag: "isULID",
      regExp
    },
    ...annotations
  });
}
function isBase64(annotations) {
  const regExp = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
  return isPattern2(regExp, {
    expected: "a base64 encoded string",
    meta: {
      _tag: "isBase64",
      regExp
    },
    ...annotations
  });
}
function isBase64Url(annotations) {
  const regExp = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
  return isPattern2(regExp, {
    expected: "a base64url encoded string",
    meta: {
      _tag: "isBase64Url",
      regExp
    },
    ...annotations
  });
}
function isStartsWith(startsWith, annotations) {
  const formatted = JSON.stringify(startsWith);
  return makeFilter2((s) => s.startsWith(startsWith), {
    expected: `a string starting with ${formatted}`,
    meta: {
      _tag: "isStartsWith",
      startsWith,
      regExp: new globalThis.RegExp(`^${startsWith}`)
    },
    arbitrary: {
      constraint: {
        patterns: [`^${startsWith}`]
      }
    },
    ...annotations
  });
}
function isEndsWith(endsWith, annotations) {
  const formatted = JSON.stringify(endsWith);
  return makeFilter2((s) => s.endsWith(endsWith), {
    expected: `a string ending with ${formatted}`,
    meta: {
      _tag: "isEndsWith",
      endsWith,
      regExp: new globalThis.RegExp(`${endsWith}$`)
    },
    arbitrary: {
      constraint: {
        patterns: [`${endsWith}$`]
      }
    },
    ...annotations
  });
}
function isIncludes(includes, annotations) {
  const formatted = JSON.stringify(includes);
  return makeFilter2((s) => s.includes(includes), {
    expected: `a string including ${formatted}`,
    meta: {
      _tag: "isIncludes",
      includes,
      regExp: new globalThis.RegExp(includes)
    },
    arbitrary: {
      constraint: {
        patterns: [includes]
      }
    },
    ...annotations
  });
}
var UPPERCASED_PATTERN = "^[^a-z]*$";
function isUppercased(annotations) {
  return makeFilter2((s) => s.toUpperCase() === s, {
    expected: "a string with all characters in uppercase",
    meta: {
      _tag: "isUppercased",
      regExp: new globalThis.RegExp(UPPERCASED_PATTERN)
    },
    arbitrary: {
      constraint: {
        patterns: [UPPERCASED_PATTERN]
      }
    },
    ...annotations
  });
}
var LOWERCASED_PATTERN = "^[^A-Z]*$";
function isLowercased(annotations) {
  return makeFilter2((s) => s.toLowerCase() === s, {
    expected: "a string with all characters in lowercase",
    meta: {
      _tag: "isLowercased",
      regExp: new globalThis.RegExp(LOWERCASED_PATTERN)
    },
    arbitrary: {
      constraint: {
        patterns: [LOWERCASED_PATTERN]
      }
    },
    ...annotations
  });
}
var CAPITALIZED_PATTERN = "^[^a-z]?.*$";
function isCapitalized(annotations) {
  return makeFilter2((s) => s.charAt(0).toUpperCase() === s.charAt(0), {
    expected: "a string with the first character in uppercase",
    meta: {
      _tag: "isCapitalized",
      regExp: new globalThis.RegExp(CAPITALIZED_PATTERN)
    },
    arbitrary: {
      constraint: {
        patterns: [CAPITALIZED_PATTERN]
      }
    },
    ...annotations
  });
}
var UNCAPITALIZED_PATTERN = "^[^A-Z]?.*$";
function isUncapitalized(annotations) {
  return makeFilter2((s) => s.charAt(0).toLowerCase() === s.charAt(0), {
    expected: "a string with the first character in lowercase",
    meta: {
      _tag: "isUncapitalized",
      regExp: new globalThis.RegExp(UNCAPITALIZED_PATTERN)
    },
    arbitrary: {
      constraint: {
        patterns: [UNCAPITALIZED_PATTERN]
      }
    },
    ...annotations
  });
}
function isFinite(annotations) {
  return makeFilter2((n) => globalThis.Number.isFinite(n), {
    expected: "a finite number",
    meta: {
      _tag: "isFinite"
    },
    arbitrary: {
      constraint: {
        noInfinity: true,
        noNaN: true
      }
    },
    ...annotations
  });
}
function makeIsGreaterThan(options) {
  const gt = isGreaterThan(options.order);
  const formatter = options.formatter ?? format;
  return (exclusiveMinimum, annotations) => {
    return makeFilter2((input) => gt(input, exclusiveMinimum), {
      expected: `a value greater than ${formatter(exclusiveMinimum)}`,
      arbitrary: {
        constraint: {
          ordered: {
            order: options.order,
            minimum: exclusiveMinimum,
            exclusiveMinimum: true
          }
        }
      },
      ...options.annotate?.(exclusiveMinimum),
      ...annotations
    });
  };
}
function makeIsGreaterThanOrEqualTo(options) {
  const gte = isGreaterThanOrEqualTo(options.order);
  const formatter = options.formatter ?? format;
  return (minimum, annotations) => {
    return makeFilter2((input) => gte(input, minimum), {
      expected: `a value greater than or equal to ${formatter(minimum)}`,
      arbitrary: {
        constraint: {
          ordered: {
            order: options.order,
            minimum
          }
        }
      },
      ...options.annotate?.(minimum),
      ...annotations
    });
  };
}
function makeIsLessThan(options) {
  const lt = isLessThan(options.order);
  const formatter = options.formatter ?? format;
  return (exclusiveMaximum, annotations) => {
    return makeFilter2((input) => lt(input, exclusiveMaximum), {
      expected: `a value less than ${formatter(exclusiveMaximum)}`,
      arbitrary: {
        constraint: {
          ordered: {
            order: options.order,
            maximum: exclusiveMaximum,
            exclusiveMaximum: true
          }
        }
      },
      ...options.annotate?.(exclusiveMaximum),
      ...annotations
    });
  };
}
function makeIsLessThanOrEqualTo(options) {
  const lte = isLessThanOrEqualTo(options.order);
  const formatter = options.formatter ?? format;
  return (maximum, annotations) => {
    return makeFilter2((input) => lte(input, maximum), {
      expected: `a value less than or equal to ${formatter(maximum)}`,
      arbitrary: {
        constraint: {
          ordered: {
            order: options.order,
            maximum
          }
        }
      },
      ...options.annotate?.(maximum),
      ...annotations
    });
  };
}
function makeIsBetween(deriveOptions) {
  const greaterThanOrEqualTo = isGreaterThanOrEqualTo(deriveOptions.order);
  const greaterThan = isGreaterThan(deriveOptions.order);
  const lessThanOrEqualTo = isLessThanOrEqualTo(deriveOptions.order);
  const lessThan = isLessThan(deriveOptions.order);
  const formatter = deriveOptions.formatter ?? format;
  return (options, annotations) => {
    const gte = options.exclusiveMinimum ? greaterThan : greaterThanOrEqualTo;
    const lte = options.exclusiveMaximum ? lessThan : lessThanOrEqualTo;
    return makeFilter2((input) => gte(input, options.minimum) && lte(input, options.maximum), {
      expected: `a value between ${formatter(options.minimum)}${options.exclusiveMinimum ? " (excluded)" : ""} and ${formatter(options.maximum)}${options.exclusiveMaximum ? " (excluded)" : ""}`,
      arbitrary: {
        constraint: {
          ordered: {
            order: deriveOptions.order,
            minimum: options.minimum,
            maximum: options.maximum,
            ...options.exclusiveMinimum && {
              exclusiveMinimum: true
            },
            ...options.exclusiveMaximum && {
              exclusiveMaximum: true
            }
          }
        }
      },
      ...deriveOptions.annotate?.(options),
      ...annotations
    });
  };
}
function makeIsMultipleOf(options) {
  return (divisor, annotations) => {
    const formatter = options.formatter ?? format;
    return makeFilter2((input) => options.remainder(input, divisor) === options.zero, {
      expected: `a value that is a multiple of ${formatter(divisor)}`,
      ...options.annotate?.(divisor),
      ...annotations
    });
  };
}
var isGreaterThan4 = /* @__PURE__ */ makeIsGreaterThan({
  order: Number2,
  annotate: (exclusiveMinimum) => ({
    meta: {
      _tag: "isGreaterThan",
      exclusiveMinimum
    }
  })
});
var isGreaterThanOrEqualTo3 = /* @__PURE__ */ makeIsGreaterThanOrEqualTo({
  order: Number2,
  annotate: (minimum) => ({
    meta: {
      _tag: "isGreaterThanOrEqualTo",
      minimum
    }
  })
});
var isLessThan4 = /* @__PURE__ */ makeIsLessThan({
  order: Number2,
  annotate: (exclusiveMaximum) => ({
    meta: {
      _tag: "isLessThan",
      exclusiveMaximum
    }
  })
});
var isLessThanOrEqualTo3 = /* @__PURE__ */ makeIsLessThanOrEqualTo({
  order: Number2,
  annotate: (maximum) => ({
    meta: {
      _tag: "isLessThanOrEqualTo",
      maximum
    }
  })
});
var isBetween2 = /* @__PURE__ */ makeIsBetween({
  order: Number2,
  annotate: (options) => {
    return {
      meta: {
        _tag: "isBetween",
        ...options
      }
    };
  }
});
var isMultipleOf = /* @__PURE__ */ makeIsMultipleOf({
  remainder,
  zero: 0,
  annotate: (divisor) => ({
    expected: `a value that is a multiple of ${divisor}`,
    meta: {
      _tag: "isMultipleOf",
      divisor
    }
  })
});
function isInt(annotations) {
  return makeFilter2((n) => globalThis.Number.isSafeInteger(n), {
    expected: "an integer",
    meta: {
      _tag: "isInt"
    },
    arbitrary: {
      constraint: {
        integer: true
      }
    },
    ...annotations
  });
}
function isInt32(annotations) {
  return new FilterGroup([isInt(annotations), isBetween2({
    minimum: -2147483648,
    maximum: 2147483647
  })], {
    expected: "a 32-bit integer",
    ...annotations
  });
}
function isUint32(annotations) {
  return new FilterGroup([isInt(), isBetween2({
    minimum: 0,
    maximum: 4294967295
  })], {
    expected: "a 32-bit unsigned integer",
    ...annotations
  });
}
function isDateValid(annotations) {
  return makeFilter2((date2) => !isNaN(date2.getTime()), {
    expected: "a valid date",
    meta: {
      _tag: "isDateValid"
    },
    arbitrary: {
      constraint: {
        valid: true
      }
    },
    ...annotations
  });
}
var isGreaterThanDate = /* @__PURE__ */ makeIsGreaterThan({
  order: Date2,
  annotate: (exclusiveMinimum) => ({
    meta: {
      _tag: "isGreaterThanDate",
      exclusiveMinimum
    }
  })
});
var isGreaterThanOrEqualToDate = /* @__PURE__ */ makeIsGreaterThanOrEqualTo({
  order: Date2,
  annotate: (minimum) => ({
    meta: {
      _tag: "isGreaterThanOrEqualToDate",
      minimum
    }
  })
});
var isLessThanDate = /* @__PURE__ */ makeIsLessThan({
  order: Date2,
  annotate: (exclusiveMaximum) => ({
    meta: {
      _tag: "isLessThanDate",
      exclusiveMaximum
    }
  })
});
var isLessThanOrEqualToDate = /* @__PURE__ */ makeIsLessThanOrEqualTo({
  order: Date2,
  annotate: (maximum) => ({
    meta: {
      _tag: "isLessThanOrEqualToDate",
      maximum
    }
  })
});
var isBetweenDate = /* @__PURE__ */ makeIsBetween({
  order: Date2,
  annotate: (options) => ({
    meta: {
      _tag: "isBetweenDate",
      ...options
    }
  })
});
var isGreaterThanBigInt = /* @__PURE__ */ makeIsGreaterThan({
  order: BigInt2,
  annotate: (exclusiveMinimum) => ({
    meta: {
      _tag: "isGreaterThanBigInt",
      exclusiveMinimum
    }
  })
});
var isGreaterThanOrEqualToBigInt = /* @__PURE__ */ makeIsGreaterThanOrEqualTo({
  order: BigInt2,
  annotate: (minimum) => ({
    meta: {
      _tag: "isGreaterThanOrEqualToBigInt",
      minimum
    }
  })
});
var isLessThanBigInt = /* @__PURE__ */ makeIsLessThan({
  order: BigInt2,
  annotate: (exclusiveMaximum) => ({
    meta: {
      _tag: "isLessThanBigInt",
      exclusiveMaximum
    }
  })
});
var isLessThanOrEqualToBigInt = /* @__PURE__ */ makeIsLessThanOrEqualTo({
  order: BigInt2,
  annotate: (maximum) => ({
    meta: {
      _tag: "isLessThanOrEqualToBigInt",
      maximum
    }
  })
});
var isBetweenBigInt = /* @__PURE__ */ makeIsBetween({
  order: BigInt2,
  annotate: (options) => ({
    meta: {
      _tag: "isBetweenBigInt",
      ...options
    }
  })
});
var isGreaterThanBigDecimal = /* @__PURE__ */ makeIsGreaterThan({
  order: Order,
  formatter: (bd) => format2(bd)
});
var isGreaterThanOrEqualToBigDecimal = /* @__PURE__ */ makeIsGreaterThanOrEqualTo({
  order: Order,
  formatter: (bd) => format2(bd)
});
var isLessThanBigDecimal = /* @__PURE__ */ makeIsLessThan({
  order: Order,
  formatter: (bd) => format2(bd)
});
var isLessThanOrEqualToBigDecimal = /* @__PURE__ */ makeIsLessThanOrEqualTo({
  order: Order,
  formatter: (bd) => format2(bd)
});
var isBetweenBigDecimal = /* @__PURE__ */ makeIsBetween({
  order: Order,
  formatter: (bd) => format2(bd)
});
function isMinLength(minLength, annotations) {
  minLength = Math.max(0, Math.floor(minLength));
  return makeFilter2((input) => input.length >= minLength, {
    expected: `a value with a length of at least ${minLength}`,
    meta: {
      _tag: "isMinLength",
      minLength
    },
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitrary: {
      constraint: {
        minLength
      }
    },
    ...annotations
  });
}
function isNonEmpty(annotations) {
  return isMinLength(1, annotations);
}
function isMaxLength(maxLength, annotations) {
  maxLength = Math.max(0, Math.floor(maxLength));
  return makeFilter2((input) => input.length <= maxLength, {
    expected: `a value with a length of at most ${maxLength}`,
    meta: {
      _tag: "isMaxLength",
      maxLength
    },
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitrary: {
      constraint: {
        maxLength
      }
    },
    ...annotations
  });
}
function isLengthBetween(minimum, maximum, annotations) {
  minimum = Math.max(0, Math.floor(minimum));
  maximum = Math.max(0, Math.floor(maximum));
  return makeFilter2((input) => input.length >= minimum && input.length <= maximum, {
    expected: minimum === maximum ? `a value with a length of ${minimum}` : `a value with a length between ${minimum} and ${maximum}`,
    meta: {
      _tag: "isLengthBetween",
      minimum,
      maximum
    },
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitrary: {
      constraint: {
        minLength: minimum,
        maxLength: maximum
      }
    },
    ...annotations
  });
}
function isMinSize(minSize, annotations) {
  minSize = Math.max(0, Math.floor(minSize));
  return makeFilter2((input) => input.size >= minSize, {
    expected: `a value with a size of at least ${minSize}`,
    meta: {
      _tag: "isMinSize",
      minSize
    },
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitrary: {
      constraint: {
        minLength: minSize
      }
    },
    ...annotations
  });
}
function isMaxSize(maxSize, annotations) {
  maxSize = Math.max(0, Math.floor(maxSize));
  return makeFilter2((input) => input.size <= maxSize, {
    expected: `a value with a size of at most ${maxSize}`,
    meta: {
      _tag: "isMaxSize",
      maxSize
    },
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitrary: {
      constraint: {
        maxLength: maxSize
      }
    },
    ...annotations
  });
}
function isSizeBetween(minimum, maximum, annotations) {
  minimum = Math.max(0, Math.floor(minimum));
  maximum = Math.max(0, Math.floor(maximum));
  return makeFilter2((input) => input.size >= minimum && input.size <= maximum, {
    expected: minimum === maximum ? `a value with a size of ${minimum}` : `a value with a size between ${minimum} and ${maximum}`,
    meta: {
      _tag: "isSizeBetween",
      minimum,
      maximum
    },
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitrary: {
      constraint: {
        minLength: minimum,
        maxLength: maximum
      }
    },
    ...annotations
  });
}
function isMinProperties(minProperties, annotations) {
  minProperties = Math.max(0, Math.floor(minProperties));
  return makeFilter2((input) => Reflect.ownKeys(input).length >= minProperties, {
    expected: `a value with at least ${minProperties === 1 ? "1 entry" : `${minProperties} entries`}`,
    meta: {
      _tag: "isMinProperties",
      minProperties
    },
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitrary: {
      constraint: {
        minLength: minProperties
      }
    },
    ...annotations
  });
}
function isMaxProperties(maxProperties, annotations) {
  maxProperties = Math.max(0, Math.floor(maxProperties));
  return makeFilter2((input) => Reflect.ownKeys(input).length <= maxProperties, {
    expected: `a value with at most ${maxProperties === 1 ? "1 entry" : `${maxProperties} entries`}`,
    meta: {
      _tag: "isMaxProperties",
      maxProperties
    },
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitrary: {
      constraint: {
        maxLength: maxProperties
      }
    },
    ...annotations
  });
}
function isPropertiesLengthBetween(minimum, maximum, annotations) {
  minimum = Math.max(0, Math.floor(minimum));
  maximum = Math.max(0, Math.floor(maximum));
  return makeFilter2((input) => Reflect.ownKeys(input).length >= minimum && Reflect.ownKeys(input).length <= maximum, {
    expected: minimum === maximum ? `a value with exactly ${minimum === 1 ? "1 entry" : `${minimum} entries`}` : `a value with between ${minimum} and ${maximum} entries`,
    meta: {
      _tag: "isPropertiesLengthBetween",
      minimum,
      maximum
    },
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitrary: {
      constraint: {
        minLength: minimum,
        maxLength: maximum
      }
    },
    ...annotations
  });
}
function isPropertyNames(keySchema, annotations) {
  const propertyNames = toEncoded2(keySchema);
  const parser = _issue(propertyNames.ast);
  return makeFilter2((input, ast, options) => {
    const keys3 = Reflect.ownKeys(input);
    const issues = [];
    for (const key of keys3) {
      const issue = parser(key, options);
      if (issue !== undefined) {
        issues.push(new Pointer([key], issue));
        if (options.errors === "first")
          break;
      }
    }
    if (isArrayNonEmpty2(issues)) {
      return new Composite(ast, some2(input), issues);
    }
    return true;
  }, {
    expected: "an object with property names matching the schema",
    meta: {
      _tag: "isPropertyNames",
      propertyNames: propertyNames.ast
    },
    [STRUCTURAL_ANNOTATION_KEY]: true,
    ...annotations
  });
}
function isUnique(annotations) {
  const equivalence = asEquivalence();
  return makeFilter2((input) => dedupeWith(input, equivalence).length === input.length, {
    expected: "an array with unique items",
    meta: {
      _tag: "isUnique"
    },
    arbitrary: {
      constraint: {
        unique: true
      }
    },
    ...annotations
  });
}
var NonEmptyString = /* @__PURE__ */ String5.check(/* @__PURE__ */ isNonEmpty());
var Char = /* @__PURE__ */ String5.check(/* @__PURE__ */ isLengthBetween(1, 1));
function Option(value3) {
  const schema = declareConstructor()([value3], ([value4]) => (input, ast, options) => {
    if (isOption2(input)) {
      if (isNone2(input)) {
        return succeedNone2;
      }
      return mapBothEager2(decodeUnknownEffect(value4)(input.value, options), {
        onSuccess: some2,
        onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["value"], issue)])
      });
    }
    return fail5(new InvalidType(ast, some2(input)));
  }, {
    typeConstructor: {
      _tag: "effect/Option"
    },
    generation: {
      runtime: `Schema.Option(?)`,
      Type: `Option.Option<?>`,
      importDeclaration: `import * as Option from "effect/Option"`
    },
    expected: "Option",
    toCodec: ([value4]) => link()(Union2([Struct({
      _tag: Literal2("Some"),
      value: value4
    }), Struct({
      _tag: Literal2("None")
    })]), transform2({
      decode: (e) => e._tag === "None" ? none2() : some2(e.value),
      encode: (o) => isSome2(o) ? {
        _tag: "Some",
        value: o.value
      } : {
        _tag: "None"
      }
    })),
    toArbitrary: ([value4]) => (fc, ctx) => {
      const terminal = fc.constant(none2());
      const arbitrary = fc.oneof(terminal, value4.arbitrary.map(some2));
      return withRecursion(fc, ctx, terminal, arbitrary);
    },
    toEquivalence: ([value4]) => makeEquivalence(value4),
    toFormatter: ([value4]) => match({
      onNone: () => "none()",
      onSome: (t) => `some(${value4(t)})`
    })
  });
  return make18(schema.ast, {
    value: value3
  });
}
function OptionFromNullOr(schema) {
  return NullOr(schema).pipe(decodeTo2(Option(toType2(schema)), optionFromNullOr()));
}
function OptionFromUndefinedOr(schema) {
  return UndefinedOr(schema).pipe(decodeTo2(Option(toType2(schema)), optionFromUndefinedOr()));
}
function OptionFromNullishOr(schema, options) {
  return NullishOr(schema).pipe(decodeTo2(Option(toType2(schema)), optionFromNullishOr(options)));
}
function OptionFromOptionalKey(schema) {
  return optionalKey2(schema).pipe(decodeTo2(Option(toType2(schema)), optionFromOptionalKey()));
}
function OptionFromOptional(schema) {
  return optional(schema).pipe(decodeTo2(Option(toType2(schema)), optionFromOptional()));
}
function OptionFromOptionalNullOr(schema, options) {
  const onNoneEncoding = options === undefined ? "omit" : options.onNoneEncoding;
  const noneValue = onNoneEncoding === null ? null : undefined;
  return optional(NullOr(schema)).pipe(decodeTo2(Option(toType2(schema)), transformOptional2({
    decode: (oe) => oe.pipe(filter(isNotNullish), some2),
    encode: onNoneEncoding === "omit" ? flatten : (ot) => some2(getOrElse(flatten(ot), () => noneValue))
  })));
}
function Result(success, failure) {
  const schema = declareConstructor()([success, failure], ([success2, failure2]) => (input, ast, options) => {
    if (!isResult2(input)) {
      return fail5(new InvalidType(ast, some2(input)));
    }
    switch (input._tag) {
      case "Success":
        return mapBothEager2(decodeEffect(success2)(input.success, options), {
          onSuccess: succeed2,
          onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["success"], issue)])
        });
      case "Failure":
        return mapBothEager2(decodeEffect(failure2)(input.failure, options), {
          onSuccess: fail2,
          onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["failure"], issue)])
        });
    }
  }, {
    typeConstructor: {
      _tag: "effect/Result"
    },
    generation: {
      runtime: `Schema.Result(?, ?)`,
      Type: `Result.Result<?, ?>`,
      importDeclaration: `import * as Result from "effect/Result"`
    },
    expected: "Result",
    toCodec: ([success2, failure2]) => link()(Union2([Struct({
      _tag: Literal2("Success"),
      success: success2
    }), Struct({
      _tag: Literal2("Failure"),
      failure: failure2
    })]), transform2({
      decode: (e) => e._tag === "Success" ? succeed2(e.success) : fail2(e.failure),
      encode: (r) => isSuccess2(r) ? {
        _tag: "Success",
        success: r.success
      } : {
        _tag: "Failure",
        failure: r.failure
      }
    })),
    toArbitrary: ([success2, failure2]) => (fc, ctx) => {
      const terminal = oneOfArbitraries(fc, success2.terminal?.map((a) => succeed2(a)), failure2.terminal?.map((e) => fail2(e)));
      const arbitrary = fc.oneof(success2.arbitrary.map((a) => succeed2(a)), failure2.arbitrary.map((e) => fail2(e)));
      return withRecursion(fc, ctx, terminal, arbitrary);
    },
    toEquivalence: ([success2, failure2]) => makeEquivalence2(success2, failure2),
    toFormatter: ([success2, failure2]) => match2({
      onSuccess: (t) => `success(${success2(t)})`,
      onFailure: (t) => `failure(${failure2(t)})`
    })
  });
  return make18(schema.ast, {
    success,
    failure
  });
}
function Redacted(value3, options) {
  const decodeLabel = typeof options?.label === "string" ? decodeUnknownEffect(Literal2(options.label)) : undefined;
  const schema = declareConstructor()([value3], ([value4]) => (input, ast, poptions) => {
    if (isRedacted(input)) {
      const label = decodeLabel !== undefined ? mapErrorEager2(decodeLabel(input.label, poptions), (issue) => new Pointer(["label"], issue)) : void_3;
      return flatMapEager2(label, () => mapBothEager2(decodeUnknownEffect(value4)(value2(input), poptions), {
        onSuccess: () => input,
        onFailure: () => {
          const oinput = some2(input);
          return new Composite(ast, oinput, [new Pointer(["value"], new InvalidValue(oinput))]);
        }
      }));
    }
    return fail5(new InvalidType(ast, some2(input)));
  }, {
    typeConstructor: {
      _tag: "effect/Redacted",
      options
    },
    generation: {
      runtime: options !== undefined ? `Schema.Redacted(?, ${format(options)})` : `Schema.Redacted(?)`,
      Type: `Redacted.Redacted<?>`,
      importDeclaration: `import * as Redacted from "effect/Redacted"`
    },
    expected: "Redacted",
    toCodecJson: ([value4]) => link()(redact3(value4), {
      decode: transform((e) => make12(e, {
        label: options?.label
      })),
      encode: options?.disallowJsonEncode ? forbidden((oe) => "Cannot serialize Redacted" + (isSome2(oe) && typeof oe.value.label === "string" ? ` with label: "${oe.value.label}"` : "")) : transform(value2)
    }),
    toArbitrary: ([value4]) => () => ({
      arbitrary: value4.arbitrary.map((a) => make12(a, {
        label: options?.label
      })),
      terminal: value4.terminal?.map((a) => make12(a, {
        label: options?.label
      }))
    }),
    toFormatter: () => globalThis.String,
    toEquivalence: ([value4]) => makeEquivalence4(value4)
  });
  return make18(schema.ast, {
    value: value3
  });
}
function redact3(schema) {
  return middlewareDecoding2(mapErrorEager2(redact2))(schema);
}
function RedactedFromValue(value3, options) {
  return redact3(value3).pipe(decodeTo2(Redacted(toType2(value3), {
    label: options?.label,
    disallowJsonEncode: options?.disallowEncode
  }), {
    decode: transform((t) => make12(t, {
      label: options?.label
    })),
    encode: options?.disallowEncode ? forbidden((oe) => "Cannot encode Redacted" + (isSome2(oe) && typeof oe.value.label === "string" ? ` with label: "${oe.value.label}"` : "")) : transform(value2)
  }));
}
function CauseReason(error, defect) {
  const schema = declareConstructor()([error, defect], ([error2, defect2]) => (input, ast, options) => {
    if (!isReason(input)) {
      return fail5(new InvalidType(ast, some2(input)));
    }
    switch (input._tag) {
      case "Fail":
        return mapBothEager2(decodeUnknownEffect(error2)(input.error, options), {
          onSuccess: makeFailReason,
          onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["error"], issue)])
        });
      case "Die":
        return mapBothEager2(decodeUnknownEffect(defect2)(input.defect, options), {
          onSuccess: makeDieReason,
          onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["defect"], issue)])
        });
      case "Interrupt":
        return succeed5(input);
    }
  }, {
    typeConstructor: {
      _tag: "effect/Cause/Failure"
    },
    generation: {
      runtime: `Schema.CauseReason(?, ?)`,
      Type: `Cause.Failure<?, ?>`,
      importDeclaration: `import * as Cause from "effect/Cause"`
    },
    expected: "Cause.Failure",
    toCodec: ([error2, defect2]) => link()(Union2([Struct({
      _tag: Literal2("Fail"),
      error: error2
    }), Struct({
      _tag: Literal2("Die"),
      defect: defect2
    }), Struct({
      _tag: Literal2("Interrupt"),
      fiberId: UndefinedOr(Finite)
    })]), transform2({
      decode: (e) => {
        switch (e._tag) {
          case "Fail":
            return makeFailReason(e.error);
          case "Die":
            return makeDieReason(e.defect);
          case "Interrupt":
            return makeInterruptReason2(e.fiberId);
        }
      },
      encode: identity
    })),
    toArbitrary: ([error2, defect2]) => causeReasonToArbitrary(error2, defect2),
    toEquivalence: ([error2, defect2]) => causeReasonToEquivalence(error2, defect2),
    toFormatter: ([error2, defect2]) => causeReasonToFormatter(error2, defect2)
  });
  return make18(schema.ast, {
    error,
    defect
  });
}
function causeReasonToArbitrary(error, defect) {
  return (fc, ctx) => {
    const terminal = fc.constant(makeInterruptReason2());
    const arbitrary = fc.oneof(terminal, fc.integer({
      min: 1
    }).map(makeInterruptReason2), error.arbitrary.map((e) => makeFailReason(e)), defect.arbitrary.map((d) => makeDieReason(d)));
    return withRecursion(fc, ctx, terminal, arbitrary);
  };
}
function causeReasonToEquivalence(error, defect) {
  return (a, b) => {
    if (a._tag !== b._tag)
      return false;
    switch (a._tag) {
      case "Fail":
        return error(a.error, b.error);
      case "Die":
        return defect(a.defect, b.defect);
      case "Interrupt":
        return a.fiberId === b.fiberId;
    }
  };
}
function causeReasonToFormatter(error, defect) {
  return (t) => {
    switch (t._tag) {
      case "Fail":
        return `Fail(${error(t.error)})`;
      case "Die":
        return `Die(${defect(t.defect)})`;
      case "Interrupt":
        return "Interrupt";
    }
  };
}
function Cause(error, defect) {
  const schema = declareConstructor()([error, defect], ([error2, defect2]) => {
    const failures = ArraySchema(CauseReason(error2, defect2));
    return (input, ast, options) => {
      if (!isCause2(input)) {
        return fail5(new InvalidType(ast, some2(input)));
      }
      return mapBothEager2(decodeUnknownEffect(failures)(input.reasons, options), {
        onSuccess: fromReasons,
        onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["failures"], issue)])
      });
    };
  }, {
    typeConstructor: {
      _tag: "effect/Cause"
    },
    generation: {
      runtime: `Schema.Cause(?, ?)`,
      Type: `Cause.Cause<?, ?>`,
      importDeclaration: `import * as Cause from "effect/Cause"`
    },
    expected: "Cause",
    toCodec: ([error2, defect2]) => link()(ArraySchema(CauseReason(error2, defect2)), transform2({
      decode: fromReasons,
      encode: ({
        reasons: failures
      }) => failures
    })),
    toArbitrary: ([error2, defect2]) => causeToArbitrary(error2, defect2),
    toEquivalence: ([error2, defect2]) => causeToEquivalence(error2, defect2),
    toFormatter: ([error2, defect2]) => causeToFormatter(error2, defect2)
  });
  return make18(schema.ast, {
    error,
    defect
  });
}
function causeToArbitrary(error, defect) {
  return (fc, ctx) => {
    const reason = causeReasonToArbitrary(error, defect)(fc, ctx);
    const terminal = fc.constant(empty4);
    const arbitrary = fc.array(reason.arbitrary).map(fromReasons);
    return withRecursion(fc, ctx, terminal, arbitrary);
  };
}
function causeToEquivalence(error, defect) {
  const failures = Array_(causeReasonToEquivalence(error, defect));
  return (a, b) => failures(a.reasons, b.reasons);
}
function causeToFormatter(error, defect) {
  const causeReason = causeReasonToFormatter(error, defect);
  return (t) => `Cause([${t.reasons.map(causeReason).join(", ")}])`;
}
var getErrorOptionsKey = (options) => (options?.includeStack === true ? 1 : 0) | (options?.excludeCause === true ? 2 : 0);
var getErrorOptions = (key) => {
  switch (key) {
    case 0:
      return;
    case 1:
      return {
        includeStack: true
      };
    case 2:
      return {
        excludeCause: true
      };
    case 3:
      return {
        includeStack: true,
        excludeCause: true
      };
  }
};
var errorSchemaCache = [];
function Error3(options) {
  const key = getErrorOptionsKey(options);
  const cached2 = errorSchemaCache[key];
  if (cached2 !== undefined) {
    return cached2;
  }
  const normalizedOptions = getErrorOptions(key);
  const schema = instanceOf(globalThis.Error, {
    typeConstructor: {
      _tag: "Error",
      ...normalizedOptions === undefined ? {} : {
        options: normalizedOptions
      }
    },
    generation: {
      runtime: normalizedOptions !== undefined ? `Schema.Error(${format(normalizedOptions)})` : `Schema.Error()`,
      Type: `globalThis.Error`
    },
    expected: "Error",
    toCodecJson: () => link()(JsonError, errorFromJsonError(normalizedOptions)),
    toArbitrary: () => (fc) => fc.string().map((message) => new globalThis.Error(message))
  });
  errorSchemaCache[key] = schema;
  return schema;
}
var defectSchemaCache = [];
function Defect(options) {
  const key = getErrorOptionsKey(options);
  const cached2 = defectSchemaCache[key];
  if (cached2 !== undefined) {
    return cached2;
  }
  const schema = Json2.pipe(decodeTo2(Unknown2, defectFromJson(getErrorOptions(key))));
  defectSchemaCache[key] = schema;
  return schema;
}
function Exit(value3, error, defect) {
  const schema = declareConstructor()([value3, error, defect], ([value4, error2, defect2]) => {
    const cause = Cause(error2, defect2);
    return (input, ast, options) => {
      if (!isExit2(input)) {
        return fail5(new InvalidType(ast, some2(input)));
      }
      switch (input._tag) {
        case "Success":
          return mapBothEager2(decodeUnknownEffect(value4)(input.value, options), {
            onSuccess: succeed4,
            onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["value"], issue)])
          });
        case "Failure":
          return mapBothEager2(decodeUnknownEffect(cause)(input.cause, options), {
            onSuccess: failCause2,
            onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["cause"], issue)])
          });
      }
    };
  }, {
    typeConstructor: {
      _tag: "effect/Exit"
    },
    generation: {
      runtime: `Schema.Exit(?, ?, ?)`,
      Type: `Exit.Exit<?, ?, ?>`,
      importDeclaration: `import * as Exit from "effect/Exit"`
    },
    expected: "Exit",
    toCodec: ([value4, error2, defect2]) => link()(Union2([Struct({
      _tag: Literal2("Success"),
      value: value4
    }), Struct({
      _tag: Literal2("Failure"),
      cause: Cause(error2, defect2)
    })]), transform2({
      decode: (e) => e._tag === "Success" ? succeed4(e.value) : failCause2(e.cause),
      encode: (exit3) => isSuccess3(exit3) ? {
        _tag: "Success",
        value: exit3.value
      } : {
        _tag: "Failure",
        cause: exit3.cause
      }
    })),
    toArbitrary: ([value4, error2, defect2]) => (fc, ctx) => {
      const cause = causeToArbitrary(error2, defect2)(fc, ctx);
      const terminal = oneOfArbitraries(fc, value4.terminal?.map((v) => succeed4(v)), cause.terminal?.map((cause2) => failCause2(cause2)));
      const arbitrary = fc.oneof(value4.arbitrary.map((v) => succeed4(v)), cause.arbitrary.map((cause2) => failCause2(cause2)));
      return withRecursion(fc, ctx, terminal, arbitrary);
    },
    toEquivalence: ([value4, error2, defect2]) => {
      const cause = causeToEquivalence(error2, defect2);
      return (a, b) => {
        if (a._tag !== b._tag)
          return false;
        switch (a._tag) {
          case "Success":
            return value4(a.value, b.value);
          case "Failure":
            return cause(a.cause, b.cause);
        }
      };
    },
    toFormatter: ([value4, error2, defect2]) => {
      const cause = causeToFormatter(error2, defect2);
      return (t) => {
        switch (t._tag) {
          case "Success":
            return `Exit.Success(${value4(t.value)})`;
          case "Failure":
            return `Exit.Failure(${cause(t.cause)})`;
        }
      };
    }
  });
  return make18(schema.ast, {
    value: value3,
    error,
    defect
  });
}
function oneOfArbitraries(fc, a, b) {
  return a === undefined ? b : b === undefined ? a : fc.oneof(a, b);
}
function withRecursion(fc, ctx, terminal, arbitrary) {
  return {
    arbitrary: terminal === undefined || ctx.recursion === undefined ? arbitrary : fc.oneof(ctx.recursion, terminal, arbitrary),
    terminal
  };
}
function arrayFromItems2(fc, item, constraints, comparator) {
  return comparator === undefined ? fc.array(item, constraints) : fc.uniqueArray(item, {
    ...constraints,
    comparator
  });
}
function collectionArbitrary(fc, ctx, item, terminalItem, fromIterable7, comparator) {
  const constraint = ctx.constraint;
  const constraints = constraint === undefined || constraint.minLength === undefined && constraint.maxLength === undefined ? undefined : {
    ...constraint.minLength !== undefined ? {
      minLength: constraint.minLength
    } : {},
    ...constraint.maxLength !== undefined ? {
      maxLength: constraint.maxLength
    } : {}
  };
  if (constraints?.minLength !== undefined && constraints.maxLength !== undefined && constraints.minLength > constraints.maxLength) {
    throw new globalThis.Error("Unable to derive an arbitrary for size constraints");
  }
  const minLength = constraints?.minLength ?? 0;
  const terminal = minLength === 0 ? fc.constant([]) : terminalItem === undefined ? undefined : arrayFromItems2(fc, terminalItem, {
    ...constraints,
    maxLength: minLength
  }, comparator);
  const arrays = withRecursion(fc, ctx, terminal, arrayFromItems2(fc, item, constraints, comparator));
  return {
    arbitrary: arrays.arbitrary.map(fromIterable7),
    terminal: arrays.terminal?.map(fromIterable7)
  };
}
function entriesArbitrary(fc, ctx, key, value3, fromIterable7) {
  return collectionArbitrary(fc, ctx, fc.tuple(key.arbitrary, value3.arbitrary), key.terminal === undefined || value3.terminal === undefined ? undefined : fc.tuple(key.terminal, value3.terminal), fromIterable7, ([a], [b]) => equals(a, b));
}
function ReadonlyMap(key, value3) {
  const schema = declareConstructor()([key, value3], ([key2, value4]) => {
    const array4 = ArraySchema(Tuple([key2, value4]));
    return (input, ast, options) => {
      if (input instanceof globalThis.Map) {
        return mapBothEager2(decodeUnknownEffect(array4)([...input], options), {
          onSuccess: (array5) => new globalThis.Map(array5),
          onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["entries"], issue)])
        });
      }
      return fail5(new InvalidType(ast, some2(input)));
    };
  }, {
    typeConstructor: {
      _tag: "ReadonlyMap"
    },
    generation: {
      runtime: `Schema.ReadonlyMap(?, ?)`,
      Type: `globalThis.ReadonlyMap<?, ?>`
    },
    expected: "ReadonlyMap",
    toCodec: ([key2, value4]) => link()(ArraySchema(Tuple([key2, value4])), transform2({
      decode: (e) => new globalThis.Map(e),
      encode: (map11) => [...map11.entries()]
    })),
    toArbitrary: ([key2, value4]) => (fc, ctx) => entriesArbitrary(fc, ctx, key2, value4, (as2) => new globalThis.Map(as2)),
    toEquivalence: ([key2, value4]) => makeCompareMap(key2, value4),
    toFormatter: ([key2, value4]) => (t) => {
      const size6 = t.size;
      if (size6 === 0) {
        return "ReadonlyMap(0) {}";
      }
      const entries3 = globalThis.Array.from(t.entries()).sort().map(([k, v]) => `${key2(k)} => ${value4(v)}`);
      return `ReadonlyMap(${size6}) { ${entries3.join(", ")} }`;
    }
  });
  return make18(schema.ast, {
    key,
    value: value3
  });
}
function HashMap(key, value3) {
  const schema = declareConstructor()([key, value3], ([key2, value4]) => {
    const entries3 = ArraySchema(Tuple([key2, value4]));
    return (input, ast, options) => {
      if (isHashMap2(input)) {
        return mapBothEager2(decodeUnknownEffect(entries3)(toEntries(input), options), {
          onSuccess: fromIterable4,
          onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["entries"], issue)])
        });
      }
      return fail5(new InvalidType(ast, some2(input)));
    };
  }, {
    typeConstructor: {
      _tag: "effect/HashMap"
    },
    generation: {
      runtime: `Schema.HashMap(?, ?)`,
      Type: `HashMap.HashMap<?, ?>`,
      importDeclaration: `import * as HashMap from "effect/HashMap"`
    },
    expected: "HashMap",
    toCodec: ([key2, value4]) => link()(ArraySchema(Tuple([key2, value4])), transform2({
      decode: fromIterable4,
      encode: toEntries
    })),
    toArbitrary: ([key2, value4]) => (fc, ctx) => entriesArbitrary(fc, ctx, key2, value4, fromIterable4),
    toEquivalence: ([key2, value4]) => makeCompareMap(key2, value4),
    toFormatter: ([key2, value4]) => (t) => {
      const size6 = size3(t);
      if (size6 === 0) {
        return "HashMap(0) {}";
      }
      const entries3 = toEntries(t).sort().map(([k, v]) => `${key2(k)} => ${value4(v)}`);
      return `HashMap(${size6}) { ${entries3.join(", ")} }`;
    }
  });
  return make18(schema.ast, {
    key,
    value: value3
  });
}
function ReadonlySet(value3) {
  const schema = declareConstructor()([value3], ([value4]) => {
    const array4 = ArraySchema(value4);
    return (input, ast, options) => {
      if (input instanceof globalThis.Set) {
        return mapBothEager2(decodeUnknownEffect(array4)([...input], options), {
          onSuccess: (array5) => new globalThis.Set(array5),
          onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["values"], issue)])
        });
      }
      return fail5(new InvalidType(ast, some2(input)));
    };
  }, {
    typeConstructor: {
      _tag: "ReadonlySet"
    },
    generation: {
      runtime: `Schema.ReadonlySet(?)`,
      Type: `globalThis.ReadonlySet<?>`
    },
    expected: "ReadonlySet",
    toCodec: ([value4]) => link()(ArraySchema(value4), transform2({
      decode: (e) => new globalThis.Set(e),
      encode: (set4) => [...set4.values()]
    })),
    toArbitrary: ([value4]) => (fc, ctx) => collectionArbitrary(fc, ctx, value4.arbitrary, value4.terminal, (as2) => new globalThis.Set(as2), equals),
    toEquivalence: ([value4]) => makeCompareSet(value4),
    toFormatter: ([value4]) => (t) => {
      const size6 = t.size;
      if (size6 === 0) {
        return "ReadonlySet(0) {}";
      }
      const values2 = globalThis.Array.from(t.values()).sort().map((v) => `${value4(v)}`);
      return `ReadonlySet(${size6}) { ${values2.join(", ")} }`;
    }
  });
  return make18(schema.ast, {
    value: value3
  });
}
function HashSet(value3) {
  const schema = declareConstructor()([value3], ([value4]) => {
    const values2 = ArraySchema(value4);
    return (input, ast, options) => {
      if (isHashSet2(input)) {
        return mapBothEager2(decodeUnknownEffect(values2)(fromIterable(input), options), {
          onSuccess: fromIterable6,
          onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["values"], issue)])
        });
      }
      return fail5(new InvalidType(ast, some2(input)));
    };
  }, {
    typeConstructor: {
      _tag: "effect/HashSet"
    },
    generation: {
      runtime: `Schema.HashSet(?)`,
      Type: `HashSet.HashSet<?>`
    },
    expected: "HashSet",
    toCodec: ([value4]) => link()(ArraySchema(value4), transform2({
      decode: fromIterable6,
      encode: fromIterable
    })),
    toArbitrary: ([value4]) => (fc, ctx) => collectionArbitrary(fc, ctx, value4.arbitrary, value4.terminal, fromIterable6, equals),
    toEquivalence: ([value4]) => makeCompareSet(value4),
    toFormatter: ([value4]) => (t) => {
      const size6 = size5(t);
      if (size6 === 0) {
        return "HashSet(0) {}";
      }
      const values2 = globalThis.Array.from(t).sort().map((v) => `${value4(v)}`);
      return `HashSet(${size6}) { ${values2.join(", ")} }`;
    }
  });
  return make18(schema.ast, {
    value: value3
  });
}
function Chunk(value3) {
  const schema = declareConstructor()([value3], ([value4]) => {
    const values2 = ArraySchema(value4);
    return (input, ast, options) => {
      if (isChunk(input)) {
        return mapBothEager2(decodeUnknownEffect(values2)(fromIterable(input), options), {
          onSuccess: fromIterable2,
          onFailure: (issue) => new Composite(ast, some2(input), [new Pointer(["values"], issue)])
        });
      }
      return fail5(new InvalidType(ast, some2(input)));
    };
  }, {
    typeConstructor: {
      _tag: "effect/Chunk"
    },
    generation: {
      runtime: `Schema.Chunk(?)`,
      Type: `Chunk.Chunk<?>`
    },
    expected: "Chunk",
    toCodec: ([value4]) => link()(ArraySchema(value4), transform2({
      decode: fromIterable2,
      encode: fromIterable
    })),
    toArbitrary: ([value4]) => (fc, ctx) => collectionArbitrary(fc, ctx, value4.arbitrary, value4.terminal, fromIterable2),
    toEquivalence: ([value4]) => makeEquivalence3(value4),
    toFormatter: ([value4]) => (t) => {
      const size6 = size(t);
      if (size6 === 0) {
        return "Chunk(0) {}";
      }
      const values2 = globalThis.Array.from(t).sort().map((v) => `${value4(v)}`);
      return `Chunk(${size6}) { ${values2.join(", ")} }`;
    }
  });
  return make18(schema.ast, {
    value: value3
  });
}
var RegExp3 = /* @__PURE__ */ instanceOf(globalThis.RegExp, {
  typeConstructor: {
    _tag: "RegExp"
  },
  generation: {
    runtime: `Schema.RegExp`,
    Type: `globalThis.RegExp`
  },
  expected: "RegExp",
  toCodecJson: () => link()(Struct({
    source: String5,
    flags: String5
  }), transformOrFail2({
    decode: (e) => try_2({
      try: () => new globalThis.RegExp(e.source, e.flags),
      catch: (e2) => new InvalidValue(some2(e2), {
        message: globalThis.String(e2)
      })
    }),
    encode: (regExp) => succeed5({
      source: regExp.source,
      flags: regExp.flags
    })
  })),
  toArbitrary: () => (fc) => fc.tuple(fc.constantFrom(".", ".*", "\\d+", "\\w+", "[a-z]+", "[A-Z]+", "[0-9]+", "^[a-zA-Z0-9]+$", "^\\d{4}-\\d{2}-\\d{2}$"), fc.uniqueArray(fc.constantFrom("g", "i", "m", "s", "u", "y"), {
    minLength: 0,
    maxLength: 6
  }).map((flags) => flags.join(""))).map(([source, flags]) => new globalThis.RegExp(source, flags)),
  toEquivalence: () => (a, b) => a.source === b.source && a.flags === b.flags
});
var URLString = /* @__PURE__ */ String5.annotate({
  expected: "a string that will be decoded as a URL"
});
var URL2 = /* @__PURE__ */ instanceOf(globalThis.URL, {
  typeConstructor: {
    _tag: "URL"
  },
  generation: {
    runtime: `Schema.URL`,
    Type: `globalThis.URL`
  },
  expected: "URL",
  toCodecJson: () => link()(URLString, urlFromString),
  toArbitrary: () => (fc) => fc.webUrl().map((s) => new globalThis.URL(s)),
  toEquivalence: () => (a, b) => a.toString() === b.toString()
});
var URLFromString = /* @__PURE__ */ URLString.pipe(/* @__PURE__ */ decodeTo2(URL2, urlFromString));
function dateArbitraryConstraints(constraint, ordered, base2, toDate2) {
  const out = {
    ...base2
  };
  delete out.valid;
  if (base2?.valid || constraint?.valid) {
    out.noInvalidDate = true;
  }
  if (ordered?.minimum !== undefined) {
    const minimum = toDate2 === undefined ? ordered.minimum : toDate2(ordered.minimum);
    const nextMin = ordered.exclusiveMinimum ? new globalThis.Date(minimum.getTime() + 1) : minimum;
    if (out.min === undefined || nextMin.getTime() > out.min.getTime()) {
      out.min = nextMin;
    }
  }
  if (ordered?.maximum !== undefined) {
    const maximum = toDate2 === undefined ? ordered.maximum : toDate2(ordered.maximum);
    const nextMax = ordered.exclusiveMaximum ? new globalThis.Date(maximum.getTime() - 1) : maximum;
    if (out.max === undefined || nextMax.getTime() < out.max.getTime()) {
      out.max = nextMax;
    }
  }
  return out;
}
var DateString = /* @__PURE__ */ String5.annotate({
  expected: "a string in ISO 8601 format that will be decoded as a Date"
});
var Date4 = /* @__PURE__ */ instanceOf(globalThis.Date, {
  typeConstructor: {
    _tag: "Date"
  },
  generation: {
    runtime: `Schema.Date`,
    Type: `globalThis.Date`
  },
  expected: "Date",
  toCodecJson: () => link()(DateString, dateFromString),
  toArbitrary: () => (fc, ctx) => fc.date(dateArbitraryConstraints(ctx?.constraint, ctx?.constraint?.ordered?.order === Date2 ? ctx.constraint.ordered : undefined))
});
var DateFromString = /* @__PURE__ */ DateString.pipe(/* @__PURE__ */ decodeTo2(Date4, dateFromString));
var DateValid = /* @__PURE__ */ Date4.check(/* @__PURE__ */ isDateValid());
var Duration = /* @__PURE__ */ declare(isDuration, {
  typeConstructor: {
    _tag: "effect/Duration"
  },
  generation: {
    runtime: `Schema.Duration`,
    Type: `Duration.Duration`,
    importDeclaration: `import * as Duration from "effect/Duration"`
  },
  expected: "Duration",
  toCodecJson: () => link()(Union2([Struct({
    _tag: Literal2("Infinity")
  }), Struct({
    _tag: Literal2("NegativeInfinity")
  }), Struct({
    _tag: Literal2("Nanos"),
    value: BigInt5
  }), Struct({
    _tag: Literal2("Millis"),
    value: Int
  })]), transform2({
    decode: (e) => {
      switch (e._tag) {
        case "Infinity":
          return infinity;
        case "NegativeInfinity":
          return negativeInfinity;
        case "Nanos":
          return nanos(e.value);
        case "Millis":
          return millis(e.value);
      }
    },
    encode: (duration) => {
      switch (duration.value._tag) {
        case "Infinity":
          return {
            _tag: "Infinity"
          };
        case "NegativeInfinity":
          return {
            _tag: "NegativeInfinity"
          };
        case "Nanos":
          return {
            _tag: "Nanos",
            value: duration.value.nanos
          };
        case "Millis":
          return {
            _tag: "Millis",
            value: duration.value.millis
          };
      }
    }
  })),
  toArbitrary: () => (fc) => fc.oneof(fc.constant(infinity), fc.constant(negativeInfinity), fc.bigInt().map(nanos), fc.maxSafeInteger().map(millis)),
  toFormatter: () => globalThis.String,
  toEquivalence: () => Equivalence2
});
var DurationString = /* @__PURE__ */ String5.annotate({
  expected: "a string that will be decoded as a Duration"
});
var DurationFromString = /* @__PURE__ */ DurationString.pipe(/* @__PURE__ */ decodeTo2(Duration, durationFromString));
var bigint03 = /* @__PURE__ */ globalThis.BigInt(0);
var DurationFromNanos = /* @__PURE__ */ BigInt5.check(isGreaterThanOrEqualToBigInt(bigint03)).pipe(/* @__PURE__ */ decodeTo2(Duration, durationFromNanos));
var DurationFromMillis = /* @__PURE__ */ Number6.check(isGreaterThanOrEqualTo3(0)).pipe(/* @__PURE__ */ decodeTo2(Duration, durationFromMillis));
var BigDecimalString = /* @__PURE__ */ String5.annotate({
  expected: "a string that will be decoded as a BigDecimal"
});
var bigDecimalDefaultMaxScale = 20;
var bigDecimalInvalidOrderedConstraintsError = "Unable to derive an arbitrary for the ordered BigDecimal constraints";
function bigDecimalScaleValueAtScale(bd, scale2) {
  return scale(bd, scale2).value;
}
function bigDecimalMinValueAtScale(minimum, scale2, excluded) {
  return excluded ? bigDecimalScaleValueAtScale(floor(minimum, scale2), scale2) + globalThis.BigInt(1) : bigDecimalScaleValueAtScale(ceil(minimum, scale2), scale2);
}
function bigDecimalMaxValueAtScale(maximum, scale2, excluded) {
  return excluded ? bigDecimalScaleValueAtScale(ceil(maximum, scale2), scale2) - globalThis.BigInt(1) : bigDecimalScaleValueAtScale(floor(maximum, scale2), scale2);
}
function bigDecimalMaxScale(ordered) {
  return Math.max(bigDecimalDefaultMaxScale, ordered.minimum?.scale ?? 0, ordered.maximum?.scale ?? 0, ordered.exclusiveMinimum && ordered.minimum !== undefined ? ordered.minimum.scale + 1 : 0, ordered.exclusiveMaximum && ordered.maximum !== undefined ? ordered.maximum.scale + 1 : 0);
}
function bigDecimalValueConstraintsAtScale(ordered, scale2) {
  const constraints = {};
  if (ordered.minimum !== undefined) {
    constraints.min = bigDecimalMinValueAtScale(ordered.minimum, scale2, ordered.exclusiveMinimum === true);
  }
  if (ordered.maximum !== undefined) {
    constraints.max = bigDecimalMaxValueAtScale(ordered.maximum, scale2, ordered.exclusiveMaximum === true);
  }
  if (constraints.min !== undefined && constraints.max !== undefined && constraints.min > constraints.max) {
    return;
  }
  return constraints;
}
function bigDecimalScaleConstraints(ordered) {
  const max4 = bigDecimalMaxScale(ordered);
  if (bigDecimalValueConstraintsAtScale(ordered, max4) === undefined) {
    throw new globalThis.Error(bigDecimalInvalidOrderedConstraintsError);
  }
  let min4 = 0;
  let high = max4;
  while (min4 < high) {
    const scale2 = min4 + Math.floor((high - min4) / 2);
    if (bigDecimalValueConstraintsAtScale(ordered, scale2) === undefined) {
      min4 = scale2 + 1;
    } else {
      high = scale2;
    }
  }
  return {
    min: min4,
    max: max4
  };
}
var BigDecimal = /* @__PURE__ */ declare(isBigDecimal, {
  typeConstructor: {
    _tag: "effect/BigDecimal"
  },
  generation: {
    runtime: `Schema.BigDecimal`,
    Type: `BigDecimal.BigDecimal`,
    importDeclaration: `import * as BigDecimal from "effect/BigDecimal"`
  },
  expected: "BigDecimal",
  toCodecJson: () => link()(BigDecimalString, bigDecimalFromString),
  toArbitrary: () => (fc, ctx) => {
    const ordered = ctx.constraint?.ordered?.order === Order ? ctx.constraint.ordered : undefined;
    if (ordered === undefined) {
      return fc.tuple(fc.bigInt(), fc.integer({
        min: 0,
        max: bigDecimalDefaultMaxScale
      })).map(([value3, scale2]) => make5(value3, scale2));
    }
    return fc.integer(bigDecimalScaleConstraints(ordered)).chain((scale2) => {
      const constraints = bigDecimalValueConstraintsAtScale(ordered, scale2);
      if (constraints === undefined) {
        throw new globalThis.Error(bigDecimalInvalidOrderedConstraintsError);
      }
      return fc.bigInt(constraints).map((value3) => make5(value3, scale2));
    });
  },
  toFormatter: () => (bd) => format2(bd),
  toEquivalence: () => Equivalence
});
var BigDecimalFromString = /* @__PURE__ */ BigDecimalString.pipe(/* @__PURE__ */ decodeTo2(BigDecimal, bigDecimalFromString));
var UnknownFromJsonString = /* @__PURE__ */ fromJsonString2(Unknown2);
function fromJsonString2(schema) {
  return String5.annotate({
    expected: "a string that will be decoded as JSON",
    contentMediaType: "application/json",
    contentSchema: toEncoded(schema.ast)
  }).pipe(decodeTo2(schema, fromJsonString));
}
var File = /* @__PURE__ */ instanceOf(globalThis.File, {
  typeConstructor: {
    _tag: "File"
  },
  generation: {
    runtime: `Schema.File`,
    Type: `globalThis.File`
  },
  expected: "File",
  toCodecJson: () => link()(Struct({
    data: String5.check(isBase64()),
    type: String5,
    name: String5,
    lastModified: Number6
  }), transformOrFail2({
    decode: (e) => match2(decodeBase64(e.data), {
      onFailure: (error) => fail5(new InvalidValue(some2(e.data), {
        message: error.message
      })),
      onSuccess: (bytes) => {
        const buffer = new globalThis.Uint8Array(bytes);
        return succeed5(new globalThis.File([buffer], e.name, {
          type: e.type,
          lastModified: e.lastModified
        }));
      }
    }),
    encode: (file) => tryPromise2({
      try: async () => {
        const bytes = new globalThis.Uint8Array(await file.arrayBuffer());
        return {
          data: encodeBase64(bytes),
          type: file.type,
          name: file.name,
          lastModified: file.lastModified
        };
      },
      catch: (e) => new InvalidValue(some2(file), {
        message: globalThis.String(e)
      })
    })
  }))
});
var FormData2 = /* @__PURE__ */ instanceOf(globalThis.FormData, {
  typeConstructor: {
    _tag: "FormData"
  },
  generation: {
    runtime: `Schema.FormData`,
    Type: `globalThis.FormData`
  },
  expected: "FormData",
  toCodecJson: () => link()(ArraySchema(Tuple([String5, Union2([Struct({
    _tag: tag("String"),
    value: String5
  }), Struct({
    _tag: tag("File"),
    value: File
  })])])), transformOrFail2({
    decode: (e) => {
      const out = new globalThis.FormData;
      for (const [key, entry] of e) {
        out.append(key, entry.value);
      }
      return succeed5(out);
    },
    encode: (formData) => {
      return succeed5(globalThis.Array.from(formData.entries()).map(([key, value3]) => {
        if (typeof value3 === "string") {
          return [key, {
            _tag: "String",
            value: value3
          }];
        } else {
          return [key, {
            _tag: "File",
            value: value3
          }];
        }
      }));
    }
  }))
});
function fromFormData2(schema) {
  return FormData2.pipe(decodeTo2(schema, fromFormData));
}
var URLSearchParams2 = /* @__PURE__ */ instanceOf(globalThis.URLSearchParams, {
  typeConstructor: {
    _tag: "URLSearchParams"
  },
  generation: {
    runtime: `Schema.URLSearchParams`,
    Type: `globalThis.URLSearchParams`
  },
  expected: "URLSearchParams",
  toCodecJson: () => link()(String5.annotate({
    expected: "a query string that will be decoded as URLSearchParams"
  }), transform2({
    decode: (e) => new globalThis.URLSearchParams(e),
    encode: (params) => params.toString()
  }))
});
function fromURLSearchParams2(schema) {
  return URLSearchParams2.pipe(decodeTo2(schema, fromURLSearchParams));
}
var Finite = /* @__PURE__ */ Number6.check(/* @__PURE__ */ isFinite());
var Int = /* @__PURE__ */ Number6.check(/* @__PURE__ */ isInt());
var NumberFromString = /* @__PURE__ */ String5.annotate({
  expected: "a string that will be decoded as a number"
}).pipe(/* @__PURE__ */ decodeTo2(Number6, numberFromString));
var FiniteFromString = /* @__PURE__ */ String5.annotate({
  expected: "a string that will be decoded as a finite number"
}).pipe(/* @__PURE__ */ decodeTo2(Finite, numberFromString));
var BigIntFromString = /* @__PURE__ */ make18(bigIntString).pipe(/* @__PURE__ */ decodeTo2(BigInt5, bigintFromString));
var Trimmed = /* @__PURE__ */ String5.check(/* @__PURE__ */ isTrimmed());
var Trim = /* @__PURE__ */ String5.annotate({
  expected: "a string that will be decoded as a trimmed string"
}).pipe(/* @__PURE__ */ decodeTo2(Trimmed, /* @__PURE__ */ trim3()));
var StringFromBase64 = /* @__PURE__ */ String5.annotate({
  expected: "a base64 encoded string that will be decoded as a UTF-8 string"
}).pipe(/* @__PURE__ */ decodeTo2(String5, stringFromBase64String));
var StringFromBase64Url = /* @__PURE__ */ String5.annotate({
  expected: "a base64 (URL) encoded string that will be decoded as a UTF-8 string"
}).pipe(/* @__PURE__ */ decodeTo2(String5, stringFromBase64UrlString));
var StringFromHex = /* @__PURE__ */ String5.annotate({
  expected: "a hex encoded string that will be decoded as a UTF-8 string"
}).pipe(/* @__PURE__ */ decodeTo2(String5, stringFromHexString));
var StringFromUriComponent = /* @__PURE__ */ String5.annotate({
  expected: "a URI component encoded string that will be decoded as a UTF-8 string"
}).pipe(/* @__PURE__ */ decodeTo2(String5, stringFromUriComponent));
var PropertyKey = /* @__PURE__ */ Union2([Finite, Symbol3, String5]);
var StandardSchemaV1FailureResult = /* @__PURE__ */ Struct({
  issues: /* @__PURE__ */ ArraySchema(/* @__PURE__ */ Struct({
    message: String5,
    path: /* @__PURE__ */ optional(/* @__PURE__ */ ArraySchema(/* @__PURE__ */ Union2([PropertyKey, /* @__PURE__ */ Struct({
      key: PropertyKey
    })])))
  }))
});
var BooleanFromBit = /* @__PURE__ */ Literals([0, 1]).pipe(/* @__PURE__ */ decodeTo2(Boolean4, /* @__PURE__ */ transform2({
  decode: (bit) => bit === 1,
  encode: (bool) => bool ? 1 : 0
})));
var Base64String = /* @__PURE__ */ String5.annotate({
  expected: "a base64 encoded string that will be decoded as Uint8Array",
  format: "byte",
  contentEncoding: "base64"
});
var Uint8Array2 = /* @__PURE__ */ instanceOf(globalThis.Uint8Array, {
  typeConstructor: {
    _tag: "Uint8Array"
  },
  generation: {
    runtime: `Schema.Uint8Array`,
    Type: `globalThis.Uint8Array`
  },
  expected: "Uint8Array",
  toCodecJson: () => link()(Base64String, uint8ArrayFromBase64String),
  toArbitrary: () => (fc) => fc.uint8Array()
});
var Uint8ArrayFromBase64 = /* @__PURE__ */ Base64String.pipe(/* @__PURE__ */ decodeTo2(Uint8Array2, uint8ArrayFromBase64String));
var Uint8ArrayFromBase64Url = /* @__PURE__ */ String5.annotate({
  expected: "a base64 (URL) encoded string that will be decoded as a Uint8Array"
}).pipe(/* @__PURE__ */ decodeTo2(Uint8Array2, {
  decode: /* @__PURE__ */ decodeBase64Url2(),
  encode: /* @__PURE__ */ encodeBase64Url2()
}));
var Uint8ArrayFromHex = /* @__PURE__ */ String5.annotate({
  expected: "a hex encoded string that will be decoded as a Uint8Array"
}).pipe(/* @__PURE__ */ decodeTo2(Uint8Array2, {
  decode: /* @__PURE__ */ decodeHex2(),
  encode: /* @__PURE__ */ encodeHex2()
}));
var DateTimeUtc = /* @__PURE__ */ declare((u) => isDateTime2(u) && isUtc2(u), {
  typeConstructor: {
    _tag: "effect/DateTime.Utc"
  },
  generation: {
    runtime: `Schema.DateTimeUtc`,
    Type: `DateTime.Utc`,
    importDeclaration: `import * as DateTime from "effect/DateTime"`
  },
  expected: "DateTime.Utc",
  toCodecJson: () => link()(String5, dateTimeUtcFromString),
  toArbitrary: () => (fc, ctx) => fc.date(dateArbitraryConstraints(ctx?.constraint, ctx?.constraint?.ordered?.order === Order3 ? ctx.constraint.ordered : undefined, {
    valid: true
  }, toDateUtc2)).map((date2) => fromDateUnsafe2(date2)),
  toFormatter: () => (utc) => utc.toString(),
  toEquivalence: () => Equivalence4
});
var DateTimeUtcFromDate = /* @__PURE__ */ DateValid.pipe(/* @__PURE__ */ decodeTo2(DateTimeUtc, {
  decode: /* @__PURE__ */ dateTimeUtcFromInput(),
  encode: /* @__PURE__ */ transform(toDateUtc2)
}));
var DateTimeUtcFromString = /* @__PURE__ */ String5.annotate({
  expected: "a string that will be decoded as a DateTime.Utc"
}).pipe(/* @__PURE__ */ decodeTo2(DateTimeUtc, dateTimeUtcFromString));
var DateTimeUtcFromMillis = /* @__PURE__ */ Number6.pipe(/* @__PURE__ */ decodeTo2(DateTimeUtc, {
  decode: /* @__PURE__ */ dateTimeUtcFromInput(),
  encode: /* @__PURE__ */ transform(toEpochMillis2)
}));
var TimeZoneOffset = /* @__PURE__ */ declare(isTimeZoneOffset2, {
  typeConstructor: {
    _tag: "effect/DateTime.TimeZone.Offset"
  },
  generation: {
    runtime: `Schema.TimeZoneOffset`,
    Type: `DateTime.TimeZone.Offset`,
    importDeclaration: `import * as DateTime from "effect/DateTime"`
  },
  expected: "DateTime.TimeZone.Offset",
  toCodecJson: () => link()(Number6, timeZoneOffsetFromNumber),
  toArbitrary: () => (fc) => fc.integer({
    min: -12 * 60 * 60 * 1000,
    max: 14 * 60 * 60 * 1000
  }).map((n) => zoneMakeOffset2(n)),
  toFormatter: () => (tz) => zoneToString2(tz),
  toEquivalence: () => (a, b) => a.offset === b.offset
});
var TimeZoneNamedString = /* @__PURE__ */ String5.annotate({
  expected: "an IANA time zone identifier"
});
var TimeZoneNamed = /* @__PURE__ */ declare(isTimeZoneNamed2, {
  typeConstructor: {
    _tag: "effect/DateTime.TimeZone.Named"
  },
  generation: {
    runtime: `Schema.TimeZoneNamed`,
    Type: `DateTime.TimeZone.Named`,
    importDeclaration: `import * as DateTime from "effect/DateTime"`
  },
  expected: "DateTime.TimeZone.Named",
  toCodecJson: () => link()(TimeZoneNamedString, timeZoneNamedFromString),
  toArbitrary: () => (fc) => fc.constantFrom(...["UTC", "Europe/London", "America/New_York", "Asia/Tokyo", "Australia/Sydney"].map(zoneMakeNamedUnsafe2)),
  toFormatter: () => (tz) => zoneToString2(tz),
  toEquivalence: () => (a, b) => a.id === b.id
});
var TimeZoneNamedFromString = /* @__PURE__ */ TimeZoneNamedString.pipe(/* @__PURE__ */ decodeTo2(TimeZoneNamed, timeZoneNamedFromString));
var TimeZoneString = /* @__PURE__ */ String5.annotate({
  expected: "a time zone string (IANA identifier or offset like +03:00)"
});
var TimeZone = /* @__PURE__ */ declare(isTimeZone2, {
  typeConstructor: {
    _tag: "effect/DateTime.TimeZone"
  },
  generation: {
    runtime: `Schema.TimeZone`,
    Type: `DateTime.TimeZone`,
    importDeclaration: `import * as DateTime from "effect/DateTime"`
  },
  expected: "DateTime.TimeZone",
  toCodecJson: () => link()(TimeZoneString, timeZoneFromString),
  toArbitrary: () => (fc) => fc.oneof(fc.integer({
    min: -12 * 60 * 60 * 1000,
    max: 14 * 60 * 60 * 1000
  }).map((n) => zoneMakeOffset2(n)), fc.constantFrom(...["UTC", "Europe/London", "America/New_York", "Asia/Tokyo", "Australia/Sydney"].map(zoneMakeNamedUnsafe2))),
  toFormatter: () => (tz) => zoneToString2(tz),
  toEquivalence: () => (a, b) => zoneToString2(a) === zoneToString2(b)
});
var TimeZoneFromString = /* @__PURE__ */ TimeZoneString.pipe(/* @__PURE__ */ decodeTo2(TimeZone, timeZoneFromString));
var DateTimeZonedString = /* @__PURE__ */ String5.annotate({
  expected: "a zoned DateTime string (e.g. 2024-01-01T00:00:00.000+00:00[Europe/London])"
});
var DateTimeZoned = /* @__PURE__ */ declare((u) => isDateTime2(u) && isZoned2(u), {
  typeConstructor: {
    _tag: "effect/DateTime.Zoned"
  },
  generation: {
    runtime: `Schema.DateTimeZoned`,
    Type: `DateTime.Zoned`,
    importDeclaration: `import * as DateTime from "effect/DateTime"`
  },
  expected: "DateTime.Zoned",
  toCodecJson: () => link()(DateTimeZonedString, dateTimeZonedFromString),
  toArbitrary: () => (fc, ctx) => fc.tuple(fc.date(dateArbitraryConstraints(ctx?.constraint, ctx?.constraint?.ordered?.order === Order3 ? ctx.constraint.ordered : undefined, {
    max: new globalThis.Date(8640000000000000 - 14 * 60 * 60 * 1000),
    min: new globalThis.Date(-8640000000000000 + 14 * 60 * 60 * 1000),
    valid: true
  }, toDateUtc2)), fc.constantFrom("UTC", "Europe/London", "America/New_York", "Asia/Tokyo", "Australia/Sydney")).map(([date2, zone]) => makeZonedUnsafe2(date2, {
    timeZone: zone
  })),
  toFormatter: () => (zoned) => formatIsoZoned2(zoned),
  toEquivalence: () => Equivalence4
});
var DateTimeZonedFromString = /* @__PURE__ */ DateTimeZonedString.pipe(/* @__PURE__ */ decodeTo2(DateTimeZoned, dateTimeZonedFromString));
var immerable = /* @__PURE__ */ globalThis.Symbol.for("immer-draftable");
var payloadToken = {};
function makeClass(Inherited, identifier2, struct2, annotations, proto) {
  const getClassSchema = getClassSchemaFactory(struct2, identifier2, annotations);
  const ClassTypeId2 = getClassTypeId(identifier2);
  const out = class extends Inherited {
    constructor(...[input, options]) {
      const internalOptions = options;
      const payload = internalOptions?.["~payload"];
      const value3 = payload?.token === payloadToken ? payload.value : struct2.make(input ?? {}, options);
      super(value3, {
        ...options,
        disableChecks: true,
        "~payload": {
          token: payloadToken,
          value: value3
        }
      });
    }
    static [TypeId13] = TypeId13;
    get [ClassTypeId2]() {
      return ClassTypeId2;
    }
    static [immerable] = true;
    static identifier = identifier2;
    static fields = struct2.fields;
    static get ast() {
      return getClassSchema(this).ast;
    }
    static pipe() {
      return pipeArguments(this, arguments);
    }
    static rebuild(ast) {
      return getClassSchema(this).rebuild(ast);
    }
    static make(input, options) {
      return new this(input, options);
    }
    static makeOption(input, options) {
      return makeOption(getClassSchema(this))(input ?? {}, options);
    }
    static makeEffect(input, options) {
      return getClassSchema(this).makeEffect(input ?? {}, options);
    }
    static annotate(annotations2) {
      return this.rebuild(annotate(this.ast, annotations2));
    }
    static annotateKey(annotations2) {
      return this.rebuild(annotateKey(this.ast, annotations2));
    }
    static check(...checks) {
      return this.rebuild(appendChecks(this.ast, checks));
    }
    static extend(identifier3) {
      return (schema, annotations2) => {
        const extension = isStruct(schema) ? schema : Struct(schema);
        const fields = {
          ...struct2.fields,
          ...extension.fields
        };
        const ast = struct(fields, struct2.ast.checks, {
          identifier: identifier3
        });
        return makeClass(this, identifier3, makeStruct(appendChecks(ast, extension.ast.checks), fields), annotations2, proto);
      };
    }
    static mapFields(f, options) {
      return struct2.mapFields(f, options);
    }
  };
  if (proto !== undefined) {
    Object.assign(out.prototype, proto(identifier2));
  }
  return out;
}
function getClassTransformation(self) {
  return new Transformation(transform((input) => new self(input)), passthrough());
}
function getClassTypeId(identifier2) {
  return `~effect/Schema/Class/${identifier2}`;
}
function getClassSchemaFactory(from, identifier2, annotations) {
  let memo2;
  return (self) => {
    if (memo2 !== undefined) {
      return memo2;
    }
    const transformation = getClassTransformation(self);
    const to = make18(new Declaration([from.ast], () => (input, ast) => {
      return input instanceof self || hasProperty(input, getClassTypeId(identifier2)) ? succeed5(input) : fail5(new InvalidType(ast, some2(input)));
    }, {
      identifier: identifier2,
      [ClassTypeId]: ([from2]) => new Link(from2, transformation),
      toCodec: ([from2]) => new Link(from2.ast, transformation),
      toArbitrary: ([from2]) => () => ({
        arbitrary: from2.arbitrary.map((args2) => new self(args2)),
        terminal: from2.terminal?.map((args2) => new self(args2))
      }),
      toFormatter: ([from2]) => (t) => `${self.identifier}(${from2(t)})`,
      "~sentinels": collectSentinels(from.ast),
      ...annotations
    }));
    return memo2 = decodeTo2(to, transformation)(from);
  };
}
function isStruct(schema) {
  return isSchema(schema);
}
var Class3 = (identifier2) => (schema, annotations) => {
  const struct2 = isStruct(schema) ? schema : Struct(schema);
  return makeClass(Class2, identifier2, struct2, annotations, (identifier3) => ({
    toString() {
      return `${identifier3}(${format({
        ...this
      })})`;
    }
  }));
};
var TaggedClass = (identifier2) => {
  return (tagValue, schema, annotations) => {
    const struct2 = isStruct(schema) ? schema.mapFields((fields) => ({
      _tag: tag(tagValue),
      ...fields
    }), {
      unsafePreserveChecks: true
    }) : TaggedStruct(tagValue, schema);
    return Class3(identifier2 ?? tagValue)(struct2, annotations);
  };
};
var ErrorClass = (identifier2) => (schema, annotations) => {
  const struct2 = isStruct(schema) ? schema : Struct(schema);
  const self = makeClass(Error2, identifier2, struct2, annotations, (identifier3) => ({
    name: identifier3
  }));
  return self;
};
var TaggedErrorClass = (identifier2) => {
  return (tagValue, schema, annotations) => {
    const struct2 = isStruct(schema) ? schema.mapFields((fields) => ({
      _tag: tag(tagValue),
      ...fields
    }), {
      unsafePreserveChecks: true
    }) : TaggedStruct(tagValue, schema);
    return ErrorClass(identifier2 ?? tagValue)(struct2, annotations);
  };
};
function toArbitraryLazy(schema) {
  const lawc = memoized(schema.ast);
  return (fc) => lawc(fc, {});
}
function toArbitrary(schema, options) {
  if (options?.report === true) {
    const lawc = memoized(schema.ast);
    const report = makeReport();
    collectReport(schema.ast, report);
    return {
      value: lawc(exports_FastCheck, {}),
      report: toReport(report)
    };
  }
  return toArbitraryLazy(schema)(exports_FastCheck);
}
function overrideToFormatter(toFormatter) {
  return (self) => {
    return self.annotate({
      toFormatter
    });
  };
}
function toFormatter(schema, options) {
  return recur5(schema.ast);
  function recur5(ast) {
    const annotation = resolve(ast)?.["toFormatter"];
    if (typeof annotation === "function") {
      return annotation(isDeclaration(ast) ? ast.typeParameters.map(recur5) : []);
    }
    if (options?.onBefore) {
      const onBefore = options.onBefore(ast, recur5);
      if (onBefore !== undefined) {
        return onBefore;
      }
    }
    return on(ast);
  }
  function on(ast) {
    switch (ast._tag) {
      default:
        return format;
      case "Never":
        return () => "never";
      case "Void":
        return () => "void";
      case "Arrays": {
        const elements = ast.elements.map(recur5);
        const rest = ast.rest.map(recur5);
        return (t) => {
          const out = [];
          let i = 0;
          for (;i < elements.length; i++) {
            if (t.length < i + 1) {
              if (isOptional(ast.elements[i])) {
                continue;
              }
            } else {
              out.push(elements[i](t[i]));
            }
          }
          if (rest.length > 0) {
            const [head, ...tail] = rest;
            for (;i < t.length - tail.length; i++) {
              out.push(head(t[i]));
            }
            for (let j = 0;j < tail.length; j++) {
              i += j;
              out.push(tail[j](t[i]));
            }
          }
          return "[" + out.join(", ") + "]";
        };
      }
      case "Objects": {
        const propertySignatures = ast.propertySignatures.map((ps) => recur5(ps.type));
        const indexSignatures = ast.indexSignatures.map((is3) => recur5(is3.type));
        if (ast.propertySignatures.length === 0 && ast.indexSignatures.length === 0) {
          return format;
        }
        return (t) => {
          const out = [];
          const visited = new Set;
          for (let i = 0;i < propertySignatures.length; i++) {
            const ps = ast.propertySignatures[i];
            const name = ps.name;
            visited.add(name);
            if (isOptional(ps.type) && !Object.hasOwn(t, name)) {
              continue;
            }
            out.push(`${formatPropertyKey(name)}: ${propertySignatures[i](t[name])}`);
          }
          for (let i = 0;i < indexSignatures.length; i++) {
            const keys3 = getIndexSignatureKeys(t, ast.indexSignatures[i].parameter);
            for (const key of keys3) {
              if (visited.has(key)) {
                continue;
              }
              visited.add(key);
              out.push(`${formatPropertyKey(key)}: ${indexSignatures[i](t[key])}`);
            }
          }
          return out.length > 0 ? "{ " + out.join(", ") + " }" : "{}";
        };
      }
      case "Union": {
        const getCandidates2 = (t) => getCandidates(t, ast.types);
        return (t) => {
          const candidates = getCandidates2(t);
          const refinements = candidates.map(_is);
          for (let i = 0;i < candidates.length; i++) {
            const is3 = refinements[i];
            if (is3(t)) {
              return recur5(candidates[i])(t);
            }
          }
          return format(t);
        };
      }
      case "Suspend": {
        const get4 = memoizeThunk(() => recur5(ast.thunk()));
        return (t) => get4()(t);
      }
    }
  }
}
function overrideToEquivalence(toEquivalence2) {
  return (self) => self.annotate({
    toEquivalence: toEquivalence2
  });
}
function toEquivalence2(schema) {
  return toEquivalence(schema.ast);
}
function toRepresentation(schema) {
  return fromAST(schema.ast);
}
function toJsonSchemaDocument2(schema, options) {
  const sd = toRepresentation(schema);
  const jd = toJsonSchemaDocument(sd, options);
  return {
    dialect: "draft-2020-12",
    schema: jd.schema,
    definitions: jd.definitions
  };
}
function toCodecJson(schema) {
  return make18(toCodecJsonTop(schema.ast), {
    schema
  });
}
var toCodecJsonTop = /* @__PURE__ */ applyToSelfOrLastLinkEncoding((ast) => {
  const out = toCodecJsonBase(ast, toCodecJsonTop);
  return out !== ast && isOptional(ast) ? optionalKeyLastLink(out) : out;
});
function toCodecJsonBase(ast, recur5) {
  switch (ast._tag) {
    case "Declaration": {
      const getLink = ast.annotations?.toCodecJson ?? ast.annotations?.toCodec;
      if (isFunction(getLink)) {
        const tps = isDeclaration(ast) ? ast.typeParameters.map((tp) => make16(toEncoded(tp))) : [];
        const link2 = getLink(tps);
        const to = recur5(link2.to);
        return replaceEncoding(ast, to === link2.to ? [link2] : [new Link(to, link2.transformation)]);
      }
      return replaceEncoding(ast, [unknownToNull]);
    }
    case "Unknown":
    case "ObjectKeyword":
      return replaceEncoding(ast, [unknownToJson]);
    case "Undefined":
    case "Void":
    case "Literal":
    case "Number":
      return ast.toCodecJson();
    case "UniqueSymbol":
    case "Symbol":
    case "BigInt":
      return ast.toCodecStringTree();
    case "Objects": {
      if (ast.propertySignatures.some((ps) => typeof ps.name !== "string")) {
        throw new globalThis.Error("Objects property names must be strings", {
          cause: ast
        });
      }
      return ast.recur(recur5, parameterFromString);
    }
    case "Union": {
      const sortedTypes = jsonReorder(ast.types);
      if (sortedTypes !== ast.types) {
        return new Union(sortedTypes, ast.mode, ast.annotations, ast.checks, ast.encoding, ast.context, ast.encodingChecks).recur(recur5);
      }
      return ast.recur(recur5);
    }
    case "Arrays":
    case "Suspend":
      return ast.recur(recur5);
  }
  return ast;
}
function toCodecIso(schema) {
  return make18(toCodecIsoTop(toType(schema.ast)));
}
var toCodecIsoTop = /* @__PURE__ */ memoize((ast) => {
  const out = toCodecIsoBase(ast, toCodecIsoTop);
  return out !== ast && isOptional(ast) ? optionalKeyLastLink(out) : out;
});
function toCodecIsoBase(ast, recur5) {
  switch (ast._tag) {
    case "Declaration": {
      const getLink = ast.annotations?.toCodecIso ?? ast.annotations?.toCodec;
      if (isFunction(getLink)) {
        const link2 = getLink(ast.typeParameters.map((tp) => make16(tp)));
        const to = recur5(link2.to);
        return replaceEncoding(ast, to === link2.to ? [link2] : [new Link(to, link2.transformation)]);
      }
      return ast;
    }
    case "Arrays":
    case "Objects":
    case "Union":
    case "Suspend":
      return ast.recur(recur5);
  }
  return ast;
}
function toCodecStringTree(schema) {
  return make18(serializerStringTree(schema.ast), {
    schema
  });
}
function toCodecArrayFromSingle(schema) {
  return make18(toCodecArrayFromSingleTop(schema.ast));
}
function toEncoderXml(codec, options) {
  const rootName = resolveIdentifier(codec.ast) ?? resolveTitle(codec.ast);
  const serialize = encodeEffect(toCodecStringTree(codec));
  return (t) => serialize(t).pipe(map7((stringTree) => stringTreeToXml(stringTree, {
    rootName,
    ...options
  })));
}
function stringTreeToXml(value3, options) {
  const rootName = options.rootName ?? "root";
  const arrayItemName = options.arrayItemName ?? "item";
  const pretty2 = options.pretty ?? true;
  const indent = options.indent ?? "  ";
  const sortKeys = options.sortKeys ?? true;
  const seen = new Set;
  const lines = [];
  recur5(rootName, value3, 0);
  return lines.join(pretty2 ? `
` : "");
  function push(depth, text) {
    lines.push(pretty2 ? indent.repeat(depth) + text : text);
  }
  function recur5(tagName, node, depth, originalNameForMeta) {
    const {
      attrs,
      safe
    } = xml.tagInfo(tagName, originalNameForMeta);
    if (node === undefined) {
      push(depth, `<${safe}${attrs}/>`);
    } else if (typeof node === "string") {
      push(depth, `<${safe}${attrs}>${xml.escapeText(node)}</${safe}>`);
    } else if (typeof node !== "object" || node === null) {
      push(depth, `<${safe}${attrs}>${xml.escapeText(format(node))}</${safe}>`);
    } else {
      if (seen.has(node))
        throw new globalThis.Error("Cycle detected while serializing to XML.", {
          cause: node
        });
      seen.add(node);
      try {
        if (globalThis.globalThis.Array.isArray(node)) {
          if (node.length === 0) {
            push(depth, `<${safe}${attrs}/>`);
            return;
          }
          push(depth, `<${safe}${attrs}>`);
          for (const item of node)
            recur5(arrayItemName, item, depth + 1);
          push(depth, `</${safe}>`);
          return;
        }
        const obj = node;
        const keys3 = Object.keys(obj);
        if (sortKeys)
          keys3.sort();
        if (keys3.length === 0) {
          push(depth, `<${safe}${attrs}/>`);
          return;
        }
        push(depth, `<${safe}${attrs}>`);
        for (const k of keys3) {
          recur5(xml.parseTagName(k).safe, obj[k], depth + 1, k);
        }
        push(depth, `</${safe}>`);
      } finally {
        seen.delete(node);
      }
    }
  }
}
var xml = {
  escapeText(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  },
  escapeAttribute(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  },
  parseTagName(name) {
    const original = name;
    let safe = name;
    if (!/^[A-Za-z_]/.test(safe))
      safe = "_" + safe;
    safe = safe.replace(/[^A-Za-z0-9._-]/g, "_");
    if (/^xml/i.test(safe))
      safe = "_" + safe;
    return {
      safe,
      changed: safe !== original
    };
  },
  tagInfo(name, original) {
    const {
      changed,
      safe
    } = xml.parseTagName(name);
    const needsMeta = changed || original && original !== name;
    const attrs = needsMeta ? ` data-name="${xml.escapeAttribute(original ?? name)}"` : "";
    return {
      safe,
      attrs
    };
  }
};
function getStringTreePriority(ast) {
  switch (ast._tag) {
    case "Null":
    case "Boolean":
    case "Number":
    case "BigInt":
    case "Symbol":
    case "UniqueSymbol":
      return 0;
    default:
      return 1;
  }
}
var treeReorder = /* @__PURE__ */ makeReorder(getStringTreePriority);
function serializerTree(ast, recur5, onMissingAnnotation) {
  switch (ast._tag) {
    case "Declaration": {
      const getLink = ast.annotations?.toCodecJson ?? ast.annotations?.toCodec;
      if (isFunction(getLink)) {
        const tps = isDeclaration(ast) ? ast.typeParameters.map((tp) => make18(recur5(toEncoded(tp)))) : [];
        const link2 = getLink(tps);
        const to = recur5(link2.to);
        return replaceEncoding(ast, to === link2.to ? [link2] : [new Link(to, link2.transformation)]);
      }
      return onMissingAnnotation(ast);
    }
    case "Null":
      return replaceEncoding(ast, [nullToString]);
    case "Boolean":
      return replaceEncoding(ast, [booleanToString]);
    case "Unknown":
    case "ObjectKeyword":
      return replaceEncoding(ast, [unknownToStringTree]);
    case "Enum":
    case "Number":
    case "Literal":
    case "UniqueSymbol":
    case "Symbol":
    case "BigInt":
      return ast.toCodecStringTree();
    case "Objects": {
      if (ast.propertySignatures.some((ps) => typeof ps.name !== "string")) {
        throw new globalThis.Error("Objects property names must be strings", {
          cause: ast
        });
      }
      return ast.recur(recur5, parameterFromString);
    }
    case "Union": {
      const sortedTypes = treeReorder(ast.types);
      if (sortedTypes !== ast.types) {
        return new Union(sortedTypes, ast.mode, ast.annotations, ast.checks, ast.encoding, ast.context, ast.encodingChecks).recur(recur5);
      }
      return ast.recur(recur5);
    }
    case "Arrays":
    case "Suspend":
      return ast.recur(recur5);
  }
  return ast;
}
var nullToString = /* @__PURE__ */ new Link(/* @__PURE__ */ new Literal("null"), /* @__PURE__ */ new Transformation(/* @__PURE__ */ transform(() => null), /* @__PURE__ */ transform(() => "null")));
var booleanToString = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([/* @__PURE__ */ new Literal("true"), /* @__PURE__ */ new Literal("false")], "anyOf"), /* @__PURE__ */ new Transformation(/* @__PURE__ */ transform((s) => s === "true"), /* @__PURE__ */ String3()));
var SERIALIZER_ENSURE_ARRAY = "~effect/Schema/SERIALIZER_ENSURE_ARRAY";
var isSerializerArrayFromSingle = (ast) => isUnion(ast) && ast.annotations?.[SERIALIZER_ENSURE_ARRAY] === true;
var serializerStringTree = /* @__PURE__ */ applyToSelfOrLastLinkEncoding((ast) => {
  if (isSerializerArrayFromSingle(ast)) {
    return ast;
  }
  const out = serializerTree(ast, serializerStringTree, (ast2) => replaceEncoding(ast2, [unknownToUndefined]));
  if (out !== ast && isOptional(ast)) {
    return optionalKeyLastLink(out);
  }
  return out;
});
var unknownToUndefined = /* @__PURE__ */ new Link(undefined_2, /* @__PURE__ */ new Transformation(/* @__PURE__ */ passthrough(), /* @__PURE__ */ transform(() => {
  return;
})));
var toArrayFromSingleInputElement = (ast) => isOptional(ast) ? optionalKey(unknown) : unknown;
var arrayFromSingleTransformation = /* @__PURE__ */ new Transformation(/* @__PURE__ */ transform((input) => typeof input === "string" ? [input] : input), /* @__PURE__ */ passthrough());
var toCodecArrayFromSingleTop = /* @__PURE__ */ applyToSelfOrLastLinkEncoding((ast) => {
  if (isSerializerArrayFromSingle(ast)) {
    return ast;
  }
  const out = onSerializerArrayFromSingle(ast);
  if (isArrays(out)) {
    const ensure2 = decodeTo(new Union([new Arrays(out.isMutable, out.elements.map(toArrayFromSingleInputElement), out.rest.map(toArrayFromSingleInputElement)), string2], "anyOf", {
      [SERIALIZER_ENSURE_ARRAY]: true
    }), out, arrayFromSingleTransformation);
    return isOptional(ast) ? optionalKey(ensure2) : ensure2;
  }
  return out;
});
function onSerializerArrayFromSingle(ast) {
  return ast._tag === "Declaration" || ast._tag === "Arrays" || ast._tag === "Objects" || ast._tag === "Union" || ast._tag === "Suspend" ? ast.recur(toCodecArrayFromSingleTop) : ast;
}
function toIso(schema) {
  const serializer = toCodecIso(schema);
  return makeIso(encodeSync(serializer), decodeSync(serializer));
}
function toIsoSource(_) {
  return id();
}
function toIsoFocus(_) {
  return id();
}
function overrideToCodecIso(to, transformation) {
  return (schema) => {
    return make18(annotate(schema.ast, {
      toCodecIso: () => new Link(to.ast, make14(transformation))
    }), {
      schema
    });
  };
}
function toDifferJsonPatch(schema) {
  const serializer = toCodecJson(schema);
  const get4 = encodeSync(serializer);
  const set4 = decodeSync(serializer);
  return {
    empty: [],
    diff: (oldValue, newValue) => get3(get4(oldValue), get4(newValue)),
    combine: (first, second) => [...first, ...second],
    patch: (oldValue, patch) => {
      const value3 = get4(oldValue);
      const patched = apply(patch, value3);
      return Object.is(patched, value3) ? oldValue : set4(patched);
    }
  };
}
function Tree(node) {
  const Tree$ref = suspend2(() => Tree2);
  const Tree2 = Union2([node, ArraySchema(Tree$ref), Record(String5, Tree$ref)]);
  return Tree2;
}
var Json2 = /* @__PURE__ */ make18(Json);
var JsonError = /* @__PURE__ */ Struct({
  message: String5,
  name: /* @__PURE__ */ optionalKey2(String5),
  stack: /* @__PURE__ */ optionalKey2(String5),
  cause: /* @__PURE__ */ optionalKey2(Json2)
});
var MutableJson2 = /* @__PURE__ */ make18(MutableJson);
function resolveAnnotations(schema) {
  return resolve(schema.ast);
}
function resolveAnnotationsKey(schema) {
  return schema.ast.context?.annotations;
}
// src/outbox.ts
var JsonValueSchema = exports_Schema.suspend(() => exports_Schema.Union([
  exports_Schema.Null,
  exports_Schema.Boolean,
  exports_Schema.Number,
  exports_Schema.String,
  exports_Schema.Array(JsonValueSchema),
  exports_Schema.Record(exports_Schema.String, JsonValueSchema)
]));
var KnownOutboxKindSchema = exports_Schema.Union([
  exports_Schema.Literal("session"),
  exports_Schema.Literal("branch"),
  exports_Schema.Literal("turn"),
  exports_Schema.Literal("event"),
  exports_Schema.Literal("modelCall"),
  exports_Schema.Literal("providerCall"),
  exports_Schema.Literal("artifact")
]);
var OutboxEnvelopeSchema = exports_Schema.Struct({
  v: exports_Schema.Number,
  kind: exports_Schema.String,
  sessionId: exports_Schema.String,
  seq: exports_Schema.Number,
  ts: exports_Schema.Number,
  payload: JsonValueSchema
});
function appendOutboxLine(filePath, envelope) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(envelope)}
`, "utf8");
}
function outboxPathFor(sessionId, dir = defaultOutboxDir()) {
  return join2(dir, `${encodeURIComponent(sessionId)}.jsonl`);
}
function defaultOutboxDir(env = process.env) {
  return env["AGENT_CONTROL_PLANE_OUTBOX_DIR"] ?? join2(homedir(), ".agent-control-plane", "outbox");
}

// src/omp-publisher.ts
var ATTRIBUTION_ENTRY_TAIL = 20;
var MAX_PENDING_ATTRIBUTIONS = 20;
function createOmpPublisher(pi) {
  const publisher = new OmpOutboxPublisher;
  pi.on("session_start", publisher.guard((event, ctx) => publisher.onSessionStart(event, ctx)));
  pi.on("turn_start", publisher.guard((event, ctx) => publisher.onTurn("start", event, ctx)));
  pi.on("before_provider_request", publisher.guard((event, ctx) => publisher.onBeforeProviderRequest(event, ctx)));
  pi.on("message_end", publisher.guard((event, ctx) => publisher.onMessageEnd(event, ctx)));
  pi.on("message_start", publisher.guard((event, ctx) => publisher.onMessageStart(event, ctx)));
  pi.on("turn_end", publisher.guard((event, ctx) => publisher.onTurn("end", event, ctx)));
  pi.on("session_switch", publisher.guard((event, ctx) => publisher.onSessionSwitch(event, ctx)));
  pi.on("session_branch", publisher.guard((event, ctx) => publisher.onSessionBranch(event, ctx)));
  pi.on("session_shutdown", publisher.guard((event, ctx) => publisher.onSessionShutdown(event, ctx)));
}

class OmpOutboxPublisher {
  sessions = new Map;
  currentSessionId;
  guard(handler) {
    return (event, ctx) => {
      try {
        handler(event, ctx);
      } catch (cause) {
        try {
          this.appendPublisherError(ctx, cause);
        } catch {}
      }
    };
  }
  onSessionStart(event, ctx) {
    const state = this.stateForContext(ctx);
    const ts = timestampMillis(event.timestamp);
    const workspace = event.workspace ?? ctx.cwd ?? "";
    const meta = compactJson({ sessionFile: state.sessionFile, parentSession: event.parentSession });
    this.append(state, "session", ts, () => ({
      id: state.sessionId,
      machine: event.machine ?? "unknown",
      harness: "omp",
      workspace,
      title: event.title ?? "",
      status: "running",
      createdAt: ts,
      updatedAt: ts,
      meta: JSON.stringify(meta)
    }));
    this.appendEvent(state, ts, undefined, "session_start", {
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      workspace,
      parentSession: event.parentSession ?? null
    });
  }
  onTurn(phase, event, ctx) {
    const state = this.stateForContext(ctx);
    const branchId = event.branchId ?? "root";
    const turnOrdinal = event.seq ?? event.turnIndex ?? 0;
    const toolCallSummary = event.toolCallSummary ?? (event.toolResults === undefined ? undefined : { toolResults: event.toolResults });
    if (phase === "start") {
      const startedAt2 = timestampMillis(event.startedAt ?? event.timestamp);
      state.turnStarts.set(turnOrdinal, {
        startedAt: startedAt2,
        contextTokens: event.contextTokens ?? event.message?.usage?.totalTokens ?? 0,
        toolCalls: event.toolCalls ?? event.toolResults?.length ?? 0,
        toolCallSummary,
        editBytes: event.editBytes ?? 0,
        yieldKind: event.yieldKind
      });
      this.appendEvent(state, startedAt2, event.branchId, "turn_start", {
        turnIndex: turnOrdinal,
        branchId,
        contextTokens: event.contextTokens ?? event.message?.usage?.totalTokens ?? 0,
        toolCalls: event.toolCalls ?? event.toolResults?.length ?? 0
      });
      return;
    }
    const start = state.turnStarts.get(turnOrdinal);
    const endedAt = timestampMillis(event.endedAt ?? event.timestamp ?? event.message?.timestamp);
    const duration = event.turnDurationMs ?? event.duration ?? event.message?.duration ?? 0;
    const summary = toolCallSummary ?? start?.toolCallSummary;
    const startedAt = event.startedAt === undefined ? start?.startedAt ?? endedAt : timestampMillis(event.startedAt);
    state.turnStarts.delete(turnOrdinal);
    this.append(state, "turn", endedAt, () => compactJson({
      id: `${state.sessionId}:turn:${turnOrdinal}`,
      sessionId: state.sessionId,
      branchId,
      seq: turnOrdinal,
      startedAt,
      endedAt,
      contextTokens: event.contextTokens ?? start?.contextTokens ?? event.message?.usage?.totalTokens ?? 0,
      toolCalls: event.toolCalls ?? event.toolResults?.length ?? start?.toolCalls ?? 0,
      toolCallSummary: summary === undefined ? undefined : JSON.stringify(summary),
      editBytes: event.editBytes ?? start?.editBytes ?? 0,
      turnDurationMs: duration,
      yieldKind: event.yieldKind ?? start?.yieldKind ?? event.message?.stopReason ?? "unknown"
    }));
    this.resolveAttributionBackfill(state, ctx, endedAt);
  }
  onMessageStart(event, ctx) {
    const state = this.stateForContext(ctx);
    this.resolveAttributionBackfill(state, ctx, timestampMillis(event.timestamp));
  }
  onBeforeProviderRequest(event, ctx) {
    const state = this.stateForContext(ctx);
    state.latestProviderRequest = {
      branchId: event.branchId,
      provider: event.provider,
      model: event.model,
      api: event.api,
      payload: event.payload ?? null,
      rawRequestSupport: event.payload === undefined ? "unsupported" : "captured"
    };
  }
  onMessageEnd(event, ctx) {
    if (event.message.role !== undefined && event.message.role !== "assistant") {
      return;
    }
    const state = this.stateForContext(ctx);
    const message = event.message;
    const usage = message.usage;
    const captured = state.latestProviderRequest;
    const branchId = event.branchId ?? captured?.branchId ?? "root";
    const ts = timestampMillis(message.timestamp ?? event.timestamp);
    const provider = message.provider ?? captured?.provider ?? message.upstreamProvider ?? "unknown";
    const model = message.model ?? captured?.model ?? "unknown";
    const attribution = attributionString(provider, model, message.thinkingLevel);
    const modelCallId = `${state.sessionId}:modelCall:${state.nextSeq}`;
    const rawRequestSupport = captured?.rawRequestSupport ?? "unsupported";
    const rawRequest = captured?.payload ?? null;
    state.latestProviderRequest = undefined;
    this.append(state, "modelCall", ts, () => compactJson({
      id: modelCallId,
      ts,
      machine: "unknown",
      session: state.sessionId,
      sessionId: state.sessionId,
      branchId,
      agent: "omp",
      api: message.api ?? captured?.api ?? "unknown",
      model,
      provider,
      upstreamProvider: message.upstreamProvider,
      attribution,
      effort: "unknown",
      promptHash: "unknown",
      systemPromptHash: "unknown",
      skillProfile: "unknown",
      contextManifest: "unknown",
      packetId: "",
      tokensIn: usage?.input ?? 0,
      tokensOut: usage?.output ?? 0,
      cacheRead: usage?.cacheRead ?? 0,
      cacheWrite: usage?.cacheWrite ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      reasoningTokens: usage?.reasoningTokens ?? 0,
      premiumRequests: usage?.premiumRequests ?? 0,
      cost: usage?.cost ?? 0,
      latencyMs: message.duration ?? 0,
      ttftMs: message.ttft ?? 0,
      outcome: outcomeFor(message),
      errorClass: errorClassFor(message),
      errorMessage: message.errorMessage,
      stopReason: message.stopReason,
      stopDetails: message.stopDetails,
      retryOf: undefined,
      fallbackFrom: undefined,
      rawRequestArtifact: "",
      rawResponseArtifact: "",
      rawRequestSupport,
      rawRequest
    }));
    this.cacheAttribution(state, ts, {
      modelCallId,
      messageTimestamp: ts,
      attribution,
      probes: 0
    });
  }
  onSessionSwitch(event, ctx) {
    const state = this.stateForContext(ctx);
    const ts = timestampMillis(event.timestamp);
    const reason = event.reason ?? "unknown";
    if (reason === "fork" || reason === "resume") {
      this.appendBranch(state, ts, event.branchId, reason, {
        reason,
        previousSessionId: event.previousSessionId ?? null,
        previousSessionFile: event.previousSessionFile ?? null,
        parentSession: event.parentSession ?? null
      });
    }
    this.appendEvent(state, ts, event.branchId, "session_switch", {
      reason,
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      previousSessionId: event.previousSessionId ?? null,
      previousSessionFile: event.previousSessionFile ?? null,
      parentSession: event.parentSession ?? null
    });
  }
  onSessionBranch(event, ctx) {
    const state = this.stateForContext(ctx);
    const ts = timestampMillis(event.timestamp);
    const branchId = event.branchId;
    this.appendBranch(state, ts, branchId, "branch", {
      sourceSessionId: event.sourceSessionId ?? null,
      sourceSessionFile: event.sourceSessionFile ?? event.previousSessionFile ?? null,
      parentSession: event.parentSession ?? null,
      leafId: event.leafId ?? null
    });
    this.appendEvent(state, ts, branchId, "session_branch", {
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      sourceSessionId: event.sourceSessionId ?? null,
      sourceSessionFile: event.sourceSessionFile ?? event.previousSessionFile ?? null,
      parentSession: event.parentSession ?? null,
      leafId: event.leafId ?? null
    });
  }
  onSessionShutdown(event, ctx) {
    const state = this.stateForContext(ctx);
    const ts = timestampMillis(event.timestamp);
    this.resolveAttributionBackfill(state, ctx, ts);
    this.appendEvent(state, ts, undefined, "session_shutdown", {
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      reason: event.reason ?? null
    });
  }
  stateForContext(ctx) {
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile();
    this.currentSessionId = sessionId;
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const outboxPath = outboxPathFor(sessionId);
    const state = {
      sessionId,
      sessionFile,
      outboxPath,
      nextSeq: countExistingOutboxLines(outboxPath),
      turnStarts: new Map,
      pendingAttributions: new Map
    };
    this.sessions.set(sessionId, state);
    return state;
  }
  append(state, kind, ts, buildPayload) {
    const seq = state.nextSeq;
    appendOutboxLine(state.outboxPath, {
      v: 1,
      kind,
      sessionId: state.sessionId,
      seq,
      ts,
      payload: buildPayload(seq)
    });
    state.nextSeq = seq + 1;
  }
  appendBranch(state, ts, branchId, kind, meta) {
    this.append(state, "branch", ts, (seq) => compactJson({
      id: branchId ?? `${state.sessionId}:branch:${seq}`,
      sessionId: state.sessionId,
      parentBranchId: typeof meta.parentBranchId === "string" ? meta.parentBranchId : undefined,
      kind,
      atTurn: typeof meta.atTurn === "number" ? meta.atTurn : undefined,
      createdAt: ts,
      meta: JSON.stringify(meta)
    }));
  }
  appendEvent(state, ts, branchId, kind, payload) {
    this.append(state, "event", ts, (seq) => compactJson({
      id: `${state.sessionId}:${seq}`,
      ts,
      sessionId: state.sessionId,
      seq,
      branchId,
      kind,
      payloadVersion: 1,
      payload
    }));
  }
  cacheAttribution(state, ts, pending) {
    state.pendingAttributions.set(pending.modelCallId, pending);
    while (state.pendingAttributions.size > MAX_PENDING_ATTRIBUTIONS) {
      for (const [modelCallId] of state.pendingAttributions) {
        state.pendingAttributions.delete(modelCallId);
        this.appendEvent(state, ts, undefined, "attributionMiss", {
          modelCallId,
          reason: "cacheLimitExceeded"
        });
        break;
      }
    }
  }
  resolveAttributionBackfill(state, ctx, ts) {
    if (state.pendingAttributions.size === 0 || ctx.sessionManager.getEntries === undefined) {
      return;
    }
    const entries3 = ctx.sessionManager.getEntries();
    const firstTailIndex = Math.max(0, entries3.length - ATTRIBUTION_ENTRY_TAIL);
    for (const [modelCallId, pending] of state.pendingAttributions) {
      let entryId;
      for (let index2 = entries3.length - 1;index2 >= firstTailIndex; index2 -= 1) {
        const entry = entries3[index2];
        if (entry !== undefined && entry.message?.role === "assistant" && entry.message.timestamp === pending.messageTimestamp) {
          entryId = entry.id;
          break;
        }
      }
      if (entryId !== undefined) {
        state.pendingAttributions.delete(modelCallId);
        this.appendEvent(state, ts, undefined, "attribution", {
          modelCallId,
          entryId,
          attribution: pending.attribution
        });
        continue;
      }
      const probes = pending.probes + 1;
      if (probes >= 2) {
        state.pendingAttributions.delete(modelCallId);
        this.appendEvent(state, ts, undefined, "attributionMiss", {
          modelCallId,
          reason: "entryNotFound"
        });
      } else {
        state.pendingAttributions.set(modelCallId, { ...pending, probes });
      }
    }
  }
  appendPublisherError(ctx, cause) {
    const state = this.currentSessionId === undefined ? this.stateForContext(ctx) : this.sessions.get(this.currentSessionId) ?? this.stateForContext(ctx);
    this.appendEvent(state, 0, undefined, "publisherError", {
      message: cause instanceof Error ? cause.message : String(cause)
    });
  }
}
function attributionString(provider, model, thinkingLevel) {
  return thinkingLevel === undefined || thinkingLevel === "" ? `${provider}/${model}` : `${provider}/${model}:${thinkingLevel}`;
}
function timestampMillis(timestamp) {
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
function outcomeFor(message) {
  const status = `${message.stopReason ?? ""} ${message.errorStatus ?? ""}`.toLowerCase();
  if (status.includes("refusal")) {
    return "refusal";
  }
  if (status.includes("abort")) {
    return "abort";
  }
  if (status.includes("error") || message.errorMessage !== undefined) {
    return "error";
  }
  return "ok";
}
function errorClassFor(message) {
  const outcome = outcomeFor(message);
  switch (outcome) {
    case "ok":
      return null;
    case "refusal":
      return "ProviderRefusal";
    case "abort":
      return "HarnessError";
    case "error":
      return message.errorStatus !== undefined ? `ProviderError:${message.errorStatus}` : "ProviderError";
  }
}
function countExistingOutboxLines(path) {
  if (!existsSync(path)) {
    return 0;
  }
  const bytes = readFileSync(path);
  let lines = 0;
  for (const byte of bytes) {
    if (byte === 10) {
      lines += 1;
    }
  }
  return bytes.length > 0 && bytes[bytes.length - 1] !== 10 ? lines + 1 : lines;
}
function compactJson(record3) {
  const compacted = {};
  for (const [key, value3] of Object.entries(record3)) {
    if (value3 !== undefined) {
      compacted[key] = value3;
    }
  }
  return compacted;
}
export {
  createOmpPublisher as default
};
