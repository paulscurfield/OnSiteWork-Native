const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SELF_PROFILE_FIELDS = [
  'id',
  'email',
  'full_name',
  'phone',
  'avatar_path',
].join(',');

const invalidProfile = field => new Error(`Profile query returned an invalid ${field}`);

const requiredUuid = (value, fieldName) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new Error(`${fieldName} must be a Supabase UUID`);
  }
  return value.trim().toLowerCase();
};

const optionalText = (value, fieldName) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw invalidProfile(fieldName);
  return value.trim() || null;
};

const optionalTimestamp = (value, fieldName) => {
  const timestamp = optionalText(value, fieldName);
  if (timestamp !== null && Number.isNaN(Date.parse(timestamp))) throw invalidProfile(fieldName);
  return timestamp;
};

const normalizeEmail = value => optionalText(value, 'Auth email')?.toLowerCase() ?? null;
const normalizePhone = value => {
  const phone = optionalText(value, 'Auth phone');
  return phone ? phone.replace(/[\s().-]/g, '') : null;
};

const verificationState = ({ displayed, authValue, confirmedAt, normalize }) => {
  if (!displayed) return 'unavailable';
  const normalizedDisplayed = normalize(displayed);
  const normalizedAuth = normalize(authValue);
  if (!normalizedAuth || normalizedDisplayed !== normalizedAuth) return 'unknown';
  return confirmedAt ? 'verified' : 'unverified';
};

export const mapSelfProfile = (row, authUser) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalidProfile('profile');
  if (!authUser || typeof authUser !== 'object' || Array.isArray(authUser)) throw invalidProfile('authenticated user');

  const authUserId = requiredUuid(authUser.id, 'Authenticated user ID');
  const profileId = requiredUuid(row.id, 'Profile ID');
  if (profileId !== authUserId) throw new Error('Profile query returned another user');

  const profileEmail = optionalText(row.email, 'email');
  const profilePhone = optionalText(row.phone, 'phone');
  const authEmail = optionalText(authUser.email, 'Auth email');
  const authPhone = optionalText(authUser.phone, 'Auth phone');
  const emailConfirmedAt = optionalTimestamp(authUser.email_confirmed_at, 'email confirmation');
  const phoneConfirmedAt = optionalTimestamp(authUser.phone_confirmed_at, 'phone confirmation');
  const email = profileEmail ?? authEmail;
  const phone = profilePhone ?? authPhone;

  return {
    id: profileId,
    full_name: optionalText(row.full_name, 'full name'),
    email,
    phone,
    avatar_path: optionalText(row.avatar_path, 'avatar path'),
    email_verification: verificationState({
      displayed: email,
      authValue: authEmail,
      confirmedAt: emailConfirmedAt,
      normalize: normalizeEmail,
    }),
    phone_verification: verificationState({
      displayed: phone,
      authValue: authPhone,
      confirmedAt: phoneConfirmedAt,
      normalize: normalizePhone,
    }),
  };
};

export const createProfileReadAdapter = (getUser, from) => {
  if (typeof getUser !== 'function' || typeof from !== 'function') {
    throw new Error('Supabase Auth and table clients are required');
  }

  return {
    async get(expectedUserId) {
      const normalizedExpectedUserId = requiredUuid(expectedUserId, 'Expected user ID');
      const { data: authData, error: authError } = await getUser();
      if (authError) throw authError;
      if (!authData?.user) throw Object.assign(new Error('Authentication required'), { code: '28000' });

      const authenticatedUserId = requiredUuid(authData.user.id, 'Authenticated user ID');
      if (authenticatedUserId !== normalizedExpectedUserId) {
        throw new Error('Authenticated user changed during profile loading');
      }

      const { data, error } = await from('profiles')
        .select(SELF_PROFILE_FIELDS)
        .eq('id', authenticatedUserId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return mapSelfProfile(data, authData.user);
    },
  };
};
