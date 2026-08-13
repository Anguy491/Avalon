exports.up = (pgm) => {
  pgm.createSchema('avalon_runtime', { ifNotExists: true });
};

exports.down = (pgm) => {
  pgm.dropSchema('avalon_runtime', { ifExists: true });
};
