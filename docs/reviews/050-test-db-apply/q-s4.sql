SELECT u.id, m.project_id, m.role
FROM public.users u
JOIN public.project_members m ON m.user_id = u.id
WHERE u.role = 'engineer' AND u.status = 'active' AND m.role <> 'engineer';
