const schema = 'avalon_runtime';

exports.up = (pgm) => {
  pgm.addColumns(
    { schema, name: 'sessions' },
    {
      client_platform: { type: 'varchar(24)' },
      wechat_subject_digest: { type: 'char(64)' },
    },
  );
  pgm.addConstraint(
    { schema, name: 'sessions' },
    'sessions_client_platform_allowed',
    {
      check:
        "client_platform is null or client_platform in ('IOS', 'ANDROID', 'WECHAT_MINIPROGRAM')",
    },
  );
  pgm.addConstraint(
    { schema, name: 'sessions' },
    'sessions_wechat_subject_digest_format',
    {
      check:
        "wechat_subject_digest is null or wechat_subject_digest ~ '^[0-9a-f]{64}$'",
    },
  );
  pgm.addConstraint(
    { schema, name: 'sessions' },
    'sessions_wechat_identity_consistency',
    {
      check:
        "(client_platform = 'WECHAT_MINIPROGRAM') = (wechat_subject_digest is not null)",
    },
  );
  pgm.createIndex(
    { schema, name: 'sessions' },
    ['room_id', 'wechat_subject_digest'],
    {
      name: 'sessions_room_wechat_subject_unique',
      unique: true,
      where: 'wechat_subject_digest is not null',
    },
  );
};

exports.down = (pgm) => {
  pgm.dropIndex(
    { schema, name: 'sessions' },
    ['room_id', 'wechat_subject_digest'],
    { name: 'sessions_room_wechat_subject_unique' },
  );
  pgm.dropConstraint(
    { schema, name: 'sessions' },
    'sessions_wechat_identity_consistency',
  );
  pgm.dropConstraint(
    { schema, name: 'sessions' },
    'sessions_wechat_subject_digest_format',
  );
  pgm.dropConstraint(
    { schema, name: 'sessions' },
    'sessions_client_platform_allowed',
  );
  pgm.dropColumns({ schema, name: 'sessions' }, [
    'client_platform',
    'wechat_subject_digest',
  ]);
};
