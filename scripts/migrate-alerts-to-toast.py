"""
One-shot migration: alert(...) → window.toast.X(...)
Categorizes each alert by message content (success / error / warning / info).
Run from project root: python scripts/migrate-alerts-to-toast.py
"""
import re
import os

FILES = [
    'src/components/admin/EmployeeManager.jsx',
    'src/components/admin/AttendanceTracker.jsx',
    'src/components/admin/HolidayManagement.jsx',
    'src/components/admin/DepartmentManager.jsx',
    'src/components/employee/LeaveCalendar.jsx',
    'src/components/lead/LeaveApprovalHub.jsx',
    'src/components/employee/AttendanceLogger.jsx',
    'src/components/admin/SkillAssessmentForm.jsx',
    'src/components/admin/AdminLeaveApprovals.jsx',
    'src/components/admin/ManagerReviewForm.jsx',
    'src/components/admin/PayrollManager.jsx',
    'src/components/employee/LeaveRequestForm.jsx',
    'src/components/common/ChatWidget.jsx',
]

SUCCESS_HINTS = [
    'success', 'saved', 'created', 'updated', 'deleted', 'approved',
    'rejected', 'cancelled', 'submitted', 'sign in recorded', 'sign out recorded',
    'imported', 'reset for', 'forwarded', 'leave cancelled', 'override cleared',
    'leave balance updated', 'leave granted', 'records exported',
    'template downloaded', 'marked as'
]
ERROR_HINTS = [
    'error', 'failed', 'could not', 'cannot', 'failure', 'invalid',
    'not found', 'unable', 'an error', 'something went wrong'
]
WARNING_HINTS = [
    'required', 'please ', 'select ', 'choose ', 'enter ', 'must ',
    'no leave types', 'no employee', 'no record', 'no data', 'cannot be',
    'should be', 'fill in', 'pick ', 'sundays are', 'half-day leave',
    'leave requests can only', 'must be a future', 'is required'
]

def classify(message_lower):
    for h in ERROR_HINTS:
        if h in message_lower:
            return 'error'
    for h in SUCCESS_HINTS:
        if h in message_lower:
            return 'success'
    for h in WARNING_HINTS:
        if h in message_lower:
            return 'warning'
    return 'info'

ALERT_RE = re.compile(r'\balert\s*\(')

def find_alert_calls(src):
    """Yield (start, end, args_text) for each balanced alert(...) call."""
    for m in ALERT_RE.finditer(src):
        start = m.start()
        paren_open = m.end() - 1
        depth = 1
        i = paren_open + 1
        in_str = None
        backslash_pending = False
        while i < len(src) and depth > 0:
            c = src[i]
            if backslash_pending:
                backslash_pending = False
                i += 1
                continue
            if c == "\\":
                backslash_pending = True
                i += 1
                continue
            if in_str:
                if c == in_str:
                    in_str = None
                    i += 1
                    continue
                if in_str == "`" and c == "$" and i+1 < len(src) and src[i+1] == "{":
                    depth2 = 1
                    i += 2
                    while i < len(src) and depth2 > 0:
                        if src[i] == "{":
                            depth2 += 1
                        elif src[i] == "}":
                            depth2 -= 1
                        i += 1
                    continue
                i += 1
                continue
            if c in ('"', "'", "`"):
                in_str = c
                i += 1
                continue
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
            i += 1
        end = i
        args_text = src[paren_open+1:end-1]
        yield (start, end, args_text)

def first_string_literal(args_text):
    """Extract the first string literal in args_text, or None if it isn't one."""
    s = args_text.lstrip()
    if not s:
        return None
    if s[0] not in ('"', "'", '`'):
        return None
    quote = s[0]
    out = []
    i = 1
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            out.append(s[i+1])
            i += 2
            continue
        if s[i] == quote:
            return "".join(out)
        out.append(s[i])
        i += 1
    return None

def process_file(path):
    with open(path, encoding='utf-8') as f:
        src = f.read()
    calls = list(find_alert_calls(src))
    if not calls:
        return 0, []
    decisions = []
    new_src = src
    # Replace from end → start so offsets stay valid
    for start, end, args_text in reversed(calls):
        lit = first_string_literal(args_text)
        if lit is not None:
            kind = classify(lit.lower())
            preview = lit[:50]
        else:
            preview = args_text.strip().split('\n')[0][:50]
            kind = classify(preview.lower())
        decisions.append((kind, preview))
        replacement = f"window.toast.{kind}({args_text})"
        new_src = new_src[:start] + replacement + new_src[end:]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_src)
    return len(calls), list(reversed(decisions))

if __name__ == '__main__':
    total = 0
    breakdown = {'success': 0, 'error': 0, 'warning': 0, 'info': 0}
    for f in FILES:
        if not os.path.exists(f):
            print(f"SKIP (missing): {f}")
            continue
        n, decisions = process_file(f)
        print(f"{n:3d}  {f}")
        for kind, _ in decisions:
            breakdown[kind] = breakdown.get(kind, 0) + 1
        total += n
    print(f"\nTotal: {total} alerts migrated.")
    print(f"  success: {breakdown['success']}")
    print(f"  error:   {breakdown['error']}")
    print(f"  warning: {breakdown['warning']}")
    print(f"  info:    {breakdown['info']}")
