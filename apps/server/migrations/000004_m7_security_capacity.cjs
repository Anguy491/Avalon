const schema = 'avalon_runtime';

exports.up = (pgm) => {
  pgm.addColumns(
    { schema, name: 'sessions' },
    {
      credential_generation: {
        type: 'integer',
        notNull: true,
        default: 1,
      },
    },
  );
  pgm.addConstraint(
    { schema, name: 'sessions' },
    'sessions_credential_generation_positive',
    { check: 'credential_generation > 0' },
  );
  pgm.addColumns(
    { schema, name: 'terminal_receipts' },
    {
      credential_generation: {
        type: 'integer',
        notNull: true,
        default: 1,
      },
    },
  );
};

exports.down = (pgm) => {
  pgm.dropColumn(
    { schema, name: 'terminal_receipts' },
    'credential_generation',
  );
  pgm.dropConstraint(
    { schema, name: 'sessions' },
    'sessions_credential_generation_positive',
  );
  pgm.dropColumn({ schema, name: 'sessions' }, 'credential_generation');
};
