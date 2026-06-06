import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Use service role to list all users - then filter by company_id
    const allUsers = await base44.asServiceRole.entities.User.list();
    const companyUsers = allUsers.filter(u => u.company_id === user.company_id);

    return Response.json({ users: companyUsers.map(u => ({ id: u.id, email: u.email, full_name: u.full_name, role: u.role, company_id: u.company_id })) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});