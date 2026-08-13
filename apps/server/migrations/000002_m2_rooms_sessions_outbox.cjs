const schema = 'avalon_runtime';

exports.up = (pgm) => {
  pgm.createTable(
    { schema, name: 'rooms' },
    {
      room_id: { type: 'uuid', primaryKey: true },
      room_code: { type: 'varchar(6)', notNull: true, unique: true },
      state_version: { type: 'integer', notNull: true, default: 0 },
      phase: { type: 'varchar(32)', notNull: true },
      aggregate: { type: 'jsonb', notNull: true },
      created_at: { type: 'timestamptz', notNull: true },
      last_active_at: { type: 'timestamptz', notNull: true },
      terminal_published_at: { type: 'timestamptz' },
      cleanup_after: { type: 'timestamptz' },
    },
  );
  pgm.addConstraint({ schema, name: 'rooms' }, 'rooms_room_code_format', {
    check: "room_code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$'",
  });
  pgm.addConstraint(
    { schema, name: 'rooms' },
    'rooms_state_version_nonnegative',
    {
      check: 'state_version >= 0',
    },
  );
  pgm.createIndex({ schema, name: 'rooms' }, ['cleanup_after'], {
    name: 'rooms_cleanup_after_idx',
    where: 'cleanup_after is not null',
  });

  pgm.createTable(
    { schema, name: 'players' },
    {
      player_id: { type: 'uuid', primaryKey: true },
      room_id: {
        type: 'uuid',
        notNull: true,
        references: { schema, name: 'rooms' },
        onDelete: 'CASCADE',
      },
      nickname: { type: 'text', notNull: true },
      normalized_nickname: { type: 'text', notNull: true },
      seat: { type: 'smallint', notNull: true },
      is_host: { type: 'boolean', notNull: true, default: false },
      connected: { type: 'boolean', notNull: true, default: false },
      ready: { type: 'boolean', notNull: true, default: false },
      created_at: { type: 'timestamptz', notNull: true },
    },
  );
  pgm.addConstraint({ schema, name: 'players' }, 'players_seat_range', {
    check: 'seat >= 0 and seat <= 9',
  });
  pgm.addConstraint({ schema, name: 'players' }, 'players_room_seat_unique', {
    unique: ['room_id', 'seat'],
  });
  pgm.addConstraint(
    { schema, name: 'players' },
    'players_room_nickname_unique',
    { unique: ['room_id', 'normalized_nickname'] },
  );
  pgm.createIndex({ schema, name: 'players' }, ['room_id'], {
    name: 'players_room_id_idx',
  });

  pgm.createTable(
    { schema, name: 'sessions' },
    {
      session_id: { type: 'uuid', primaryKey: true },
      token_family: { type: 'uuid', notNull: true },
      room_id: {
        type: 'uuid',
        notNull: true,
        references: { schema, name: 'rooms' },
        onDelete: 'CASCADE',
      },
      player_id: {
        type: 'uuid',
        notNull: true,
        references: { schema, name: 'players' },
        onDelete: 'CASCADE',
      },
      token_digest: { type: 'char(64)', notNull: true, unique: true },
      expires_at: { type: 'timestamptz', notNull: true },
      revoked_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true },
      rotated_at: { type: 'timestamptz' },
    },
  );
  pgm.createIndex({ schema, name: 'sessions' }, ['room_id', 'player_id'], {
    name: 'sessions_room_player_idx',
  });
  pgm.createIndex({ schema, name: 'sessions' }, ['token_family'], {
    name: 'sessions_token_family_idx',
  });

  pgm.createTable(
    { schema, name: 'processed_commands' },
    {
      scope: { type: 'varchar(80)', notNull: true },
      command_id: { type: 'uuid', notNull: true },
      room_id: {
        type: 'uuid',
        notNull: true,
        references: { schema, name: 'rooms' },
        onDelete: 'CASCADE',
      },
      token_family: { type: 'uuid' },
      auth_token_digest: { type: 'char(64)' },
      request_digest: { type: 'char(64)', notNull: true },
      response_status: { type: 'smallint', notNull: true },
      response_ciphertext: { type: 'bytea', notNull: true },
      response_iv: { type: 'bytea', notNull: true },
      response_tag: { type: 'bytea', notNull: true },
      state_version: { type: 'integer', notNull: true },
      created_at: { type: 'timestamptz', notNull: true },
    },
  );
  pgm.addConstraint(
    { schema, name: 'processed_commands' },
    'processed_commands_pkey',
    { primaryKey: ['scope', 'command_id'] },
  );
  pgm.createIndex({ schema, name: 'processed_commands' }, ['room_id'], {
    name: 'processed_commands_room_id_idx',
  });

  pgm.createTable(
    { schema, name: 'outbox' },
    {
      outbox_id: { type: 'uuid', primaryKey: true },
      event_id: { type: 'uuid', notNull: true, unique: true },
      room_id: {
        type: 'uuid',
        notNull: true,
        references: { schema, name: 'rooms' },
        onDelete: 'CASCADE',
      },
      state_version: { type: 'integer', notNull: true },
      event_type: { type: 'varchar(40)', notNull: true },
      created_at: { type: 'timestamptz', notNull: true },
      available_at: { type: 'timestamptz', notNull: true },
      claimed_by: { type: 'varchar(120)' },
      claimed_until: { type: 'timestamptz' },
      published_at: { type: 'timestamptz' },
      publish_attempts: { type: 'integer', notNull: true, default: 0 },
    },
  );
  pgm.addConstraint(
    { schema, name: 'outbox' },
    'outbox_room_version_type_unique',
    { unique: ['room_id', 'state_version', 'event_type'] },
  );
  pgm.createIndex(
    { schema, name: 'outbox' },
    ['available_at', 'claimed_until'],
    {
      name: 'outbox_pending_idx',
      where: 'published_at is null',
    },
  );

  pgm.createTable(
    { schema, name: 'terminal_receipts' },
    {
      room_id: {
        type: 'uuid',
        notNull: true,
        references: { schema, name: 'rooms' },
        onDelete: 'CASCADE',
      },
      session_id: {
        type: 'uuid',
        notNull: true,
        references: { schema, name: 'sessions' },
        onDelete: 'CASCADE',
      },
      state_version: { type: 'integer', notNull: true },
      acknowledged_at: { type: 'timestamptz' },
    },
  );
  pgm.addConstraint(
    { schema, name: 'terminal_receipts' },
    'terminal_receipts_pkey',
    { primaryKey: ['room_id', 'session_id', 'state_version'] },
  );
};

exports.down = (pgm) => {
  pgm.dropTable({ schema, name: 'terminal_receipts' });
  pgm.dropTable({ schema, name: 'outbox' });
  pgm.dropTable({ schema, name: 'processed_commands' });
  pgm.dropTable({ schema, name: 'sessions' });
  pgm.dropTable({ schema, name: 'players' });
  pgm.dropTable({ schema, name: 'rooms' });
};
