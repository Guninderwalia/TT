import React, { useEffect, useMemo, useRef, useState } from 'react';
import { generatePdf } from '../../utils/pdf/pdfGenerator';

/**
 * Company-wide org chart, available to every role.
 *
 * Hierarchy is derived purely from existing data — no new tables:
 *   • Root: the first user with role MD (else Admin)
 *   • Layer 2: department leads (one per department that has a lead_id)
 *   • Layer 3: each lead's team members
 *   • Standalone admins/managers (no lead role) sit alongside root
 *   • Employees with no department go under an "Unassigned" placeholder
 *   • Offboarded users (status='inactive') are excluded
 *
 * Rendered as a single SVG so:
 *   - The same drawing serialises straight into a PDF via pdfMake's
 *     {svg: '<svg…>'} content type — no html2canvas dep needed.
 *   - Pan/zoom works trivially via transform on the inner group.
 */

// ---------- Layout constants ----------
const NODE_W = 180;
const NODE_H = 96;
const NODE_GAP_X = 28;
const NODE_GAP_Y = 70;
const PHOTO_R = 22;

// ---------- Hierarchy helper ----------
function buildHierarchy(employees = [], departments = []) {
  const active = employees.filter(e => (e.status || 'active') === 'active');
  const byId = new Map(active.map(e => [String(e.id), e]));

  const isMD = (e) => /md|managing director/i.test(e.role || e.role_name || '');
  const isAdmin = (e) => /admin|administrator/i.test(e.role || e.role_name || '');
  const isLead = (e, dept) => (
    e.is_department_lead === 1 || e.isLead === true ||
    (dept && String(dept.lead_id ?? dept.leadId) === String(e.id))
  );

  // Root: prefer MD, else first Admin, else first user.
  let root = active.find(isMD) || active.find(isAdmin) || active[0];
  if (!root) return null;

  // Build node objects with children = [].
  const makeNode = (emp, role) => ({
    id: String(emp.id),
    name: emp.fullName || emp.full_name || emp.name || 'Unknown',
    role: role || emp.role_name || emp.role || 'Employee',
    department: emp.department || emp.department_name || null,
    pictureUrl: emp.profile_picture_path || emp.profilePicturePath || null,
    children: []
  });

  const rootNode = makeNode(root, /md|managing/i.test(root.role || root.role_name || '') ? 'MD' : 'Admin');

  // One subtree per department whose lead exists.
  for (const dept of departments || []) {
    const leadId = dept.lead_id ?? dept.leadId;
    if (!leadId) continue;
    const leadEmp = byId.get(String(leadId));
    if (!leadEmp || String(leadEmp.id) === String(root.id)) continue;
    const leadNode = makeNode(leadEmp, `Lead — ${dept.name}`);

    // Team members in that department (excluding the lead themselves).
    for (const emp of active) {
      const empDept = String(emp.departmentId ?? emp.department_id ?? '');
      if (empDept !== String(dept.id) || String(emp.id) === String(leadEmp.id)) continue;
      if (String(emp.id) === String(root.id)) continue;
      leadNode.children.push(makeNode(emp, emp.role || emp.role_name || 'Employee'));
    }
    rootNode.children.push(leadNode);
  }

  // Departments WITHOUT a lead but with members → place members as a small
  // group node under the root, labeled with the department name.
  for (const dept of departments || []) {
    if (dept.lead_id ?? dept.leadId) continue;
    const members = active.filter(e =>
      String(e.departmentId ?? e.department_id ?? '') === String(dept.id) &&
      String(e.id) !== String(root.id)
    );
    if (members.length === 0) continue;
    const groupNode = {
      id: `dept-${dept.id}`, name: dept.name, role: 'Department (no lead)',
      department: dept.name, pictureUrl: null,
      children: members.map(e => makeNode(e, e.role || e.role_name || 'Employee'))
    };
    rootNode.children.push(groupNode);
  }

  // Employees with no department go into an "Unassigned" branch.
  const orphans = active.filter(e => {
    if (String(e.id) === String(root.id)) return false;
    const d = e.departmentId ?? e.department_id;
    return !d;
  });
  if (orphans.length > 0) {
    rootNode.children.push({
      id: 'unassigned', name: 'Unassigned', role: '', department: null, pictureUrl: null,
      children: orphans.map(e => makeNode(e, e.role || e.role_name || 'Employee'))
    });
  }

  return rootNode;
}

// ---------- Layout algorithm ----------
// Single-pass bottom-up: compute each subtree width, then top-down assign x.
function layoutTree(node, depth = 0) {
  if (!node) return null;
  let subtreeWidth;
  if (!node.children || node.children.length === 0) {
    subtreeWidth = NODE_W;
  } else {
    let total = 0;
    for (const c of node.children) {
      const cl = layoutTree(c, depth + 1);
      total += cl.subtreeWidth + NODE_GAP_X;
    }
    total -= NODE_GAP_X; // remove trailing gap
    subtreeWidth = Math.max(NODE_W, total);
  }
  return { node, depth, subtreeWidth };
}

function positionTree(laid, startX = 0) {
  // Mutates laid by adding x, y. y depth-based, x centered relative to children.
  const stack = [{ laid, startX }];
  while (stack.length) {
    const { laid: cur, startX: cx } = stack.pop();
    const { node, depth, subtreeWidth } = cur;
    const nodeX = cx + (subtreeWidth - NODE_W) / 2;
    cur.x = nodeX;
    cur.y = depth * (NODE_H + NODE_GAP_Y) + 20;
    if (node.children && node.children.length > 0) {
      let childX = cx;
      for (const c of node.children) {
        const childLaid = layoutTree(c, depth + 1);
        stack.push({ laid: childLaid, startX: childX });
        childX += childLaid.subtreeWidth + NODE_GAP_X;
        // Store reference so parent can read x/y of children for connectors.
        cur.childLaids = cur.childLaids || [];
        cur.childLaids.push(childLaid);
      }
    }
  }
}

// Recursive walk that emits SVG node markup for every laid node + connectors.
function renderNodes(laid, out, isRoot = true) {
  if (!laid) return;
  const { node, x, y, childLaids } = laid;

  const isMD = /md|managing/i.test(node.role || '');
  const isLead = /lead/i.test(node.role || '');
  const border = isMD ? '#f59e0b' : isLead ? '#3b82f6' : '#64748b';

  // Card background
  out.push(`<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="10" ry="10" fill="#1f2937" stroke="${border}" stroke-width="2"/>`);

  // Photo / initial
  const cx = x + PHOTO_R + 14;
  const cy = y + NODE_H / 2;
  if (node.pictureUrl && /^data:|^https?:/.test(node.pictureUrl)) {
    out.push(`<defs><clipPath id="clip-${node.id}"><circle cx="${cx}" cy="${cy}" r="${PHOTO_R}"/></clipPath></defs>`);
    out.push(`<image href="${escapeAttr(node.pictureUrl)}" x="${cx - PHOTO_R}" y="${cy - PHOTO_R}" width="${PHOTO_R * 2}" height="${PHOTO_R * 2}" clip-path="url(#clip-${node.id})" preserveAspectRatio="xMidYMid slice"/>`);
    out.push(`<circle cx="${cx}" cy="${cy}" r="${PHOTO_R}" fill="none" stroke="${border}" stroke-width="1.5"/>`);
  } else {
    out.push(`<circle cx="${cx}" cy="${cy}" r="${PHOTO_R}" fill="${border}"/>`);
    out.push(`<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="Roboto, Arial" font-size="16" font-weight="700" fill="#fff">${escapeText((node.name || '?').charAt(0).toUpperCase())}</text>`);
  }

  // Name + role + dept
  const tx = cx + PHOTO_R + 10;
  out.push(`<text x="${tx}" y="${y + 30}" font-family="Roboto, Arial" font-size="13" font-weight="700" fill="#f3f4f6">${escapeText(truncate(node.name, 16))}</text>`);
  out.push(`<text x="${tx}" y="${y + 50}" font-family="Roboto, Arial" font-size="11" fill="${border}">${escapeText(truncate(node.role, 18))}</text>`);
  if (node.department) {
    out.push(`<text x="${tx}" y="${y + 70}" font-family="Roboto, Arial" font-size="10" fill="#94a3b8">${escapeText(truncate(node.department, 20))}</text>`);
  }

  // Connectors to children
  if (childLaids && childLaids.length > 0) {
    const parentBottomX = x + NODE_W / 2;
    const parentBottomY = y + NODE_H;
    const childTopY = childLaids[0].y;
    const midY = (parentBottomY + childTopY) / 2;
    out.push(`<line x1="${parentBottomX}" y1="${parentBottomY}" x2="${parentBottomX}" y2="${midY}" stroke="#475569" stroke-width="1.5"/>`);
    // Horizontal connector across children
    const firstCenter = childLaids[0].x + NODE_W / 2;
    const lastCenter = childLaids[childLaids.length - 1].x + NODE_W / 2;
    out.push(`<line x1="${firstCenter}" y1="${midY}" x2="${lastCenter}" y2="${midY}" stroke="#475569" stroke-width="1.5"/>`);
    for (const c of childLaids) {
      const childCenter = c.x + NODE_W / 2;
      out.push(`<line x1="${childCenter}" y1="${midY}" x2="${childCenter}" y2="${c.y}" stroke="#475569" stroke-width="1.5"/>`);
      renderNodes(c, out, false);
    }
  }
}

function escapeText(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/&/g, '&amp;');
}
function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------- Component ----------
function OrgChart() {
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const wrapperRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [empResp, deptResp] = await Promise.all([
          window.electron.getEmployees(),
          window.electron.getDepartments()
        ]);
        setEmployees(empResp?.success ? (empResp.data || []) : []);
        setDepartments(deptResp?.success ? (deptResp.data || []) : []);
      } finally { setLoading(false); }
    })();
  }, []);

  const { svgString, width, height } = useMemo(() => {
    if (loading) return { svgString: '', width: 600, height: 200 };
    const hierarchy = buildHierarchy(employees, departments);
    if (!hierarchy) return { svgString: '', width: 600, height: 200 };

    const laid = layoutTree(hierarchy);
    positionTree(laid, 0);

    // Compute total width / height by walking the laid tree.
    let maxX = 0, maxY = 0;
    const stack = [laid];
    while (stack.length) {
      const cur = stack.pop();
      maxX = Math.max(maxX, cur.x + NODE_W);
      maxY = Math.max(maxY, cur.y + NODE_H);
      for (const c of cur.childLaids || []) stack.push(c);
    }
    const w = maxX + 40;
    const h = maxY + 40;

    const out = [];
    renderNodes(laid, out);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${out.join('')}</svg>`;
    return { svgString: svg, width: w, height: h };
  }, [employees, departments, loading]);

  const handleExportPdf = async () => {
    if (!svgString) return;
    const docDef = {
      pageSize: 'A3',
      pageOrientation: 'landscape',
      pageMargins: [30, 40, 30, 30],
      content: [
        { text: 'TaskTango', fontSize: 9, color: '#94a3b8' },
        { text: 'Organisation Chart', fontSize: 16, bold: true, color: '#1e3a8a', margin: [0, 4, 0, 12] },
        { text: `Generated ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`, fontSize: 9, color: '#475569', margin: [0, 0, 0, 14] },
        { svg: svgString, width: 1100, fit: [1100, 700] }
      ],
      defaultStyle: { fontSize: 10, color: '#1a202c' }
    };
    const r = await generatePdf(docDef, `TaskTango_OrgChart_${new Date().toISOString().split('T')[0]}.pdf`);
    if (!r?.success) window.toast?.error?.('PDF export failed: ' + (r?.error || 'unknown'));
  };

  return (
    <div className="manager-container">
      <div className="manager-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2>🏢 Organisation Chart</h2>
          <p style={{ color: 'var(--text-2)', fontSize: 13, margin: '4px 0 0' }}>
            Live hierarchy: MD → Department Leads → Team Members. Updates as you add or move people.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setZoom(z => Math.max(0.4, z - 0.1))}>−</button>
          <button className="btn btn-secondary" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button className="btn btn-secondary" onClick={() => setZoom(z => Math.min(2, z + 0.1))}>+</button>
          <button className="btn btn-primary" onClick={handleExportPdf} disabled={loading || !svgString}>📄 Export PDF</button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-2)' }}>Loading organisation chart…</p>
      ) : !svgString ? (
        <p style={{ color: 'var(--text-2)' }}>No active employees to chart yet.</p>
      ) : (
        <div
          ref={wrapperRef}
          style={{
            overflow: 'auto',
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 16,
            maxHeight: '70vh'
          }}
        >
          <div
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: width * zoom, height: height * zoom }}
            // SVG-as-HTML works in every modern browser. We use dangerouslySetInnerHTML
            // so the very same svgString we ship to pdfMake renders on screen.
            dangerouslySetInnerHTML={{ __html: svgString }}
          />
        </div>
      )}
    </div>
  );
}

export default OrgChart;
