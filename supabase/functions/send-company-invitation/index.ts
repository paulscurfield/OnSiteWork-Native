import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

const FUNCTION_NAME = 'send-company-invitation';
const ALLOWED_ROLES = new Set(['worker', 'supervisor', 'admin']);
const JSON_CONTENT_TYPE = 'application/json';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_PATTERN = /^[0-9a-f]{48}$/;

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const jsonResponse = (
  status: number,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': JSON_CONTENT_TYPE,
    },
  });

const errorResponse = (error: unknown, corsHeaders: Record<string, string>) => {
  if (error instanceof HttpError) {
    return jsonResponse(
      error.status,
      { ok: false, error: error.code, message: error.message },
      corsHeaders,
    );
  }

  return jsonResponse(
    500,
    { ok: false, error: 'internal_error', message: 'Invitation delivery failed' },
    corsHeaders,
  );
};

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new HttpError(500, 'server_config_error', `${name} is not configured`);
  }
  return value;
};

const appConfig = () => {
  const publicUrlRaw = requiredEnv('APP_PUBLIC_URL');
  let publicUrl: URL;

  try {
    publicUrl = new URL(publicUrlRaw);
  } catch (_error) {
    throw new HttpError(500, 'server_config_error', 'APP_PUBLIC_URL is invalid');
  }

  if (!['http:', 'https:'].includes(publicUrl.protocol)) {
    throw new HttpError(500, 'server_config_error', 'APP_PUBLIC_URL must be http or https');
  }

  return {
    supabaseUrl: requiredEnv('SUPABASE_URL'),
    supabaseAnonKey: requiredEnv('SUPABASE_ANON_KEY'),
    supabaseServiceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    resendApiKey: requiredEnv('RESEND_API_KEY'),
    emailFrom: requiredEnv('EMAIL_FROM'),
    publicUrl,
    allowedOrigin: publicUrl.origin,
  };
};

const corsHeadersForRequest = (request: Request, allowedOrigin: string) => {
  const origin = request.headers.get('Origin');

  if (origin && origin !== allowedOrigin) {
    throw new HttpError(403, 'forbidden_origin', 'Request origin is not allowed');
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Vary': 'Origin',
  };
};

const canonicalUuid = (value: unknown, field: string) => {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_request', `${field} is required`);
  }

  const trimmed = value.trim();
  if (!UUID_PATTERN.test(trimmed)) {
    throw new HttpError(400, 'invalid_request', `${field} must be a canonical UUID`);
  }

  return trimmed;
};

const normalizedEmail = (value: unknown) => {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_request', 'email is required');
  }

  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, 'invalid_request', 'Enter a valid email address');
  }

  return email;
};

const invitationRole = (value: unknown) => {
  if (typeof value !== 'string' || !ALLOWED_ROLES.has(value)) {
    throw new HttpError(400, 'invalid_request', 'role must be worker, supervisor, or admin');
  }

  return value;
};

const requestJson = async (request: Request) => {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes(JSON_CONTENT_TYPE)) {
    throw new HttpError(400, 'invalid_request', 'POST body must be JSON');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (_error) {
    throw new HttpError(400, 'invalid_request', 'POST body must be valid JSON');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_request', 'POST body must be a JSON object');
  }

  const values = body as Record<string, unknown>;
  const keys = Object.keys(values);
  const allowedKeys = new Set(['company_id', 'email', 'role']);
  const extraKeys = keys.filter((key) => !allowedKeys.has(key));

  if (extraKeys.length > 0) {
    throw new HttpError(400, 'invalid_request', 'Unsupported request fields');
  }

  return {
    companyId: canonicalUuid(values.company_id, 'company_id'),
    email: normalizedEmail(values.email),
    role: invitationRole(values.role),
  };
};

const bearerToken = (request: Request) => {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]?.trim()) {
    throw new HttpError(401, 'authentication_required', 'Authentication required');
  }

  return {
    authHeader: `Bearer ${match[1].trim()}`,
  };
};

const createUserScopedClient = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string,
) =>
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });

const createServerClient = (supabaseUrl: string, key: string) =>
  createClient(supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

const verifyCaller = async (userClient: ReturnType<typeof createServerClient>) => {
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user?.id || !UUID_PATTERN.test(data.user.id)) {
    throw new HttpError(401, 'authentication_required', 'Authentication required');
  }

  return data.user;
};

const safeErrorCode = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }

  return null;
};

const safeErrorStatus = (error: unknown) => {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : null;
  }

  return null;
};

const isAmbiguousDeliveryError = (error: unknown) => {
  if (error instanceof HttpError) {
    return error.code === 'delivery_unknown';
  }

  const status = safeErrorStatus(error);
  const code = safeErrorCode(error);

  return (
    status === null ||
    status === 0 ||
    status >= 500 ||
    code === 'request_timeout' ||
    code === 'hook_timeout' ||
    code === 'hook_timeout_after_retry'
  );
};

const mapRpcCreateError = (error: { code?: string } | null) => {
  if (!error) return new HttpError(500, 'internal_error', 'Invitation could not be created');
  if (error.code === '28000') {
    return new HttpError(401, 'authentication_required', 'Authentication required');
  }
  if (error.code === '22023') {
    return new HttpError(400, 'invalid_request', 'Invitation request is invalid');
  }
  if (error.code === '42501') {
    return new HttpError(403, 'forbidden', 'Invitation request is not permitted');
  }
  if (error.code === '23505') {
    return new HttpError(409, 'invitation_conflict', 'Invitation could not be created');
  }

  return new HttpError(500, 'internal_error', 'Invitation could not be created');
};

const mapRpcRevokeError = (error: { code?: string } | null) => {
  if (!error) return new HttpError(500, 'internal_error', 'Invitation compensation failed');
  if (error.code === '28000') {
    return new HttpError(401, 'authentication_required', 'Authentication required');
  }
  if (error.code === '42501') {
    return new HttpError(403, 'forbidden', 'Invitation compensation is not permitted');
  }

  return new HttpError(500, 'internal_error', 'Invitation compensation failed');
};

const invitationFromRpc = (
  data: unknown,
  expected: { companyId: string; email: string; role: string },
) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(500, 'internal_error', 'Invitation response was invalid');
  }

  const invitation = (data as { invitation?: unknown }).invitation;
  if (!invitation || typeof invitation !== 'object' || Array.isArray(invitation)) {
    throw new HttpError(500, 'internal_error', 'Invitation response was invalid');
  }

  const row = invitation as Record<string, unknown>;
  const id = canonicalUuid(row.id, 'invitation.id');
  const companyId = canonicalUuid(row.company_id, 'invitation.company_id');
  const email = normalizedEmail(row.email);
  const role = invitationRole(row.role);

  if (
    companyId !== expected.companyId ||
    email !== expected.email ||
    role !== expected.role ||
    row.status !== 'pending'
  ) {
    throw new HttpError(500, 'internal_error', 'Invitation response did not match request');
  }

  if ('token' in row) {
    throw new HttpError(500, 'internal_error', 'Invitation response included restricted data');
  }

  return { id, companyId, email, role };
};

const assertNotExistingCompanyMember = async (
  userClient: ReturnType<typeof createServerClient>,
  values: { companyId: string; email: string },
) => {
  const { data, error } = await userClient.rpc('list_company_worker_directory', {
    p_company_id: values.companyId,
  });

  if (error || !Array.isArray(data)) {
    throw new HttpError(500, 'member_check_failed', 'Company membership could not be verified');
  }

  for (const row of data) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new HttpError(500, 'member_check_failed', 'Company membership could not be verified');
    }

    const email = (row as { email?: unknown }).email;
    if (typeof email === 'string' && email.trim().toLowerCase() === values.email) {
      throw new HttpError(409, 'member_exists', 'This email is already a company member');
    }
  }
};

const createOrReuseInvitation = async (
  userClient: ReturnType<typeof createServerClient>,
  values: { companyId: string; email: string; role: string },
) => {
  const { data, error } = await userClient.rpc('create_company_invitation_admin', {
    p_company_id: values.companyId,
    p_email: values.email,
    p_role: values.role,
  });

  if (!error) {
    const invitation = invitationFromRpc(data, values);
    return { invitationId: invitation.id, newlyCreated: true };
  }

  if (error.code !== '23505') {
    throw mapRpcCreateError(error);
  }

  await assertNotExistingCompanyMember(userClient, values);

  const { data: rows, error: lookupError } = await userClient
    .from('invitations')
    .select('id, company_id, email, role, status, expires_at')
    .eq('company_id', values.companyId)
    .eq('email', values.email)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());

  if (lookupError) {
    throw mapRpcCreateError(error);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    throw mapRpcCreateError(error);
  }

  if (rows.length > 1) {
    throw new HttpError(409, 'invitation_conflict', 'Multiple active pending invitations exist');
  }

  const row = rows[0] as Record<string, unknown>;
  const id = canonicalUuid(row.id, 'invitation.id');
  const companyId = canonicalUuid(row.company_id, 'invitation.company_id');
  const email = normalizedEmail(row.email);
  const role = invitationRole(row.role);

  if (
    companyId !== values.companyId ||
    email !== values.email ||
    row.status !== 'pending' ||
    typeof row.expires_at !== 'string' ||
    new Date(row.expires_at).getTime() <= Date.now()
  ) {
    throw new HttpError(409, 'invitation_conflict', 'Pending invitation is inconsistent');
  }

  if (role !== values.role) {
    throw new HttpError(409, 'invitation_conflict', 'Pending invitation role does not match');
  }

  return { invitationId: id, newlyCreated: false };
};

const retrieveInvitationToken = async (
  serviceClient: ReturnType<typeof createServerClient>,
  values: { invitationId: string; companyId: string; email: string; role: string },
) => {
  const { data, error } = await serviceClient
    .from('invitations')
    .select('id, company_id, email, role, token, status, expires_at')
    .eq('id', values.invitationId)
    .single();

  if (error || !data) {
    throw new HttpError(500, 'internal_error', 'Invitation token could not be verified');
  }

  const row = data as Record<string, unknown>;
  const id = canonicalUuid(row.id, 'invitation.id');
  const companyId = canonicalUuid(row.company_id, 'invitation.company_id');
  const email = normalizedEmail(row.email);
  const role = invitationRole(row.role);
  const token = typeof row.token === 'string' ? row.token : '';

  if (
    id !== values.invitationId ||
    companyId !== values.companyId ||
    email !== values.email ||
    role !== values.role ||
    row.status !== 'pending' ||
    typeof row.expires_at !== 'string' ||
    new Date(row.expires_at).getTime() <= Date.now() ||
    !TOKEN_PATTERN.test(token)
  ) {
    throw new HttpError(500, 'internal_error', 'Invitation token could not be verified');
  }

  return token;
};

const acceptanceUrl = (publicUrl: URL, invitationId: string, token: string) => {
  const url = new URL('/invite/accept', publicUrl);
  url.searchParams.set('invitation_id', invitationId);
  url.searchParams.set('token', token);
  return url.toString();
};

const actionLinkFromGenerateLink = (data: unknown) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(502, 'delivery_failed', 'Invitation email could not be prepared');
  }

  const properties = (data as { properties?: unknown }).properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new HttpError(502, 'delivery_failed', 'Invitation email could not be prepared');
  }

  const actionLink = (properties as { action_link?: unknown }).action_link;
  if (typeof actionLink !== 'string' || !actionLink.trim()) {
    throw new HttpError(502, 'delivery_failed', 'Invitation email could not be prepared');
  }

  let parsed: URL;
  try {
    parsed = new URL(actionLink);
  } catch (_error) {
    throw new HttpError(502, 'delivery_failed', 'Invitation email could not be prepared');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new HttpError(502, 'delivery_failed', 'Invitation email could not be prepared');
  }

  return parsed.toString();
};

const htmlAttribute = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const generateMagicLink = async (
  serviceClient: ReturnType<typeof createServerClient>,
  email: string,
  redirectTo: string,
) => {
  const { data, error } = await serviceClient.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo,
    },
  });

  if (error) {
    throw new HttpError(502, 'delivery_failed', 'Invitation email could not be prepared');
  }

  return actionLinkFromGenerateLink(data);
};

const sendResendEmail = async (
  values: { apiKey: string; from: string; to: string; actionLink: string },
) => {
  let response: Response;

  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${values.apiKey}`,
        'Content-Type': JSON_CONTENT_TYPE,
      },
      body: JSON.stringify({
        from: values.from,
        to: [values.to],
        subject: 'OnSite Timesheet invitation',
        html: [
          '<p>You have been invited to join a company in OnSite Timesheet.</p>',
          `<p><a href="${htmlAttribute(values.actionLink)}">Open invitation</a></p>`,
          '<p>If you did not expect this invitation, you can ignore this email.</p>',
        ].join(''),
        text: [
          'You have been invited to join a company in OnSite Timesheet.',
          '',
          'Open invitation:',
          values.actionLink,
          '',
          'If you did not expect this invitation, you can ignore this email.',
        ].join('\n'),
      }),
    });
  } catch (_error) {
    throw new HttpError(503, 'delivery_unknown', 'Invitation delivery could not be confirmed. Try again later.');
  }

  if (response.ok) {
    return;
  }

  if (response.status >= 400 && response.status < 500) {
    throw new HttpError(502, 'delivery_failed', 'Invitation email could not be sent');
  }

  throw new HttpError(503, 'delivery_unknown', 'Invitation delivery could not be confirmed. Try again later.');
};

const compensateNewInvitation = async (
  userClient: ReturnType<typeof createServerClient>,
  values: { newlyCreated: boolean; companyId: string; invitationId: string },
) => {
  if (!values.newlyCreated) return;

  const { error } = await userClient.rpc('revoke_company_invitation_admin', {
    p_company_id: values.companyId,
    p_invitation_id: values.invitationId,
  });

  if (error) {
    const mapped = mapRpcRevokeError(error);
    console.error(`${FUNCTION_NAME}: invitation compensation failed`, {
      status: mapped.status,
      code: mapped.code,
    });
  }
};

const deliverInvitation = async (
  serviceClient: ReturnType<typeof createServerClient>,
  values: { apiKey: string; from: string; email: string; redirectTo: string },
) => {
  const actionLink = await generateMagicLink(serviceClient, values.email, values.redirectTo);
  await sendResendEmail({
    apiKey: values.apiKey,
    from: values.from,
    to: values.email,
    actionLink,
  });

  return { delivery: 'magic_link' as const };
};

Deno.serve(async (request) => {
  let corsHeaders: Record<string, string> = {};

  try {
    const config = appConfig();
    corsHeaders = corsHeadersForRequest(request, config.allowedOrigin);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse(
        405,
        { ok: false, error: 'method_not_allowed', message: 'Method not allowed' },
        corsHeaders,
      );
    }

    const values = await requestJson(request);
    const { authHeader } = bearerToken(request);
    const userClient = createUserScopedClient(
      config.supabaseUrl,
      config.supabaseAnonKey,
      authHeader,
    );
    const serviceClient = createServerClient(config.supabaseUrl, config.supabaseServiceRoleKey);

    await verifyCaller(userClient);

    const { invitationId, newlyCreated } = await createOrReuseInvitation(userClient, values);
    const token = await retrieveInvitationToken(serviceClient, {
      invitationId,
      companyId: values.companyId,
      email: values.email,
      role: values.role,
    });
    const redirectTo = acceptanceUrl(config.publicUrl, invitationId, token);

    try {
      const { delivery } = await deliverInvitation(
        serviceClient,
        {
          apiKey: config.resendApiKey,
          from: config.emailFrom,
          email: values.email,
          redirectTo,
        },
      );

      return jsonResponse(
        200,
        {
          ok: true,
          invitation_id: invitationId,
          delivery,
          reused_pending: !newlyCreated,
        },
        corsHeaders,
      );
    } catch (deliveryError) {
      if (isAmbiguousDeliveryError(deliveryError)) {
        throw new HttpError(
          503,
          'delivery_unknown',
          'Invitation delivery could not be confirmed. Try again later.',
        );
      }

      await compensateNewInvitation(userClient, {
        newlyCreated,
        companyId: values.companyId,
        invitationId,
      });

      throw new HttpError(502, 'delivery_failed', 'Invitation email could not be sent');
    }
  } catch (error) {
    return errorResponse(error, corsHeaders);
  }
});
