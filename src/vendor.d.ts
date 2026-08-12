declare module "json-dup-key-validator" {
  const validator: {
    validate(json: string, allowDuplicatedKeys?: boolean): Error | undefined;
    parse(json: string, allowDuplicatedKeys?: boolean): unknown;
  };
  export default validator;
}
