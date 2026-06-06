import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { userId, companyId } = await req.json().catch(() => ({}));

    // Default: fix david_moss12 if no params provided
    const targetUserId = userId || '6a207dd29c92a1caa2523966';
    const targetCompanyId = companyId || '69f6dc00402c240d26dd2105';

    await base44.asServiceRole.entities.User.update(targetUserId, { company_id: targetCompanyId });

    return Response.json({ success: true, message: `User ${targetUserId} linked to company ${targetCompanyId}` });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});