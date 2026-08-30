from app.core import storage
from app.schemas.user import UserRole
from app.services import user as user_service


def _seed_with_hash(username: str, role: UserRole = UserRole.annotator) -> int:
    """A legacy record: password hash set, no email — what pre-Google users look like."""
    user_service.ensure_seed_user(username, "secret", role)
    u = user_service.get_by_username(username)
    return u.id


def test_strips_hashes_and_leaves_everything_else_alone(tmp_path):
    legacy = _seed_with_hash("annotator1")
    user_service.get_or_provision_google_user("new@x.com", None, None, UserRole.annotator)

    from scripts.strip_password_hashes import strip

    before = {u["id"]: dict(u) for u in storage.load_users()}
    assert before[legacy]["hashed_password"]

    preview = strip(apply=False)
    assert [u["id"] for u in preview] == [legacy]
    # dry run must not touch the file
    assert storage.load_users() == list(before.values())

    stripped = strip(apply=True)
    assert [u["id"] for u in stripped] == [legacy]

    after = {u["id"]: u for u in storage.load_users()}
    assert "hashed_password" not in after[legacy]
    # the record itself survives — id, username and role are what the
    # annotations and item assignments hang off
    for field in ("id", "username", "role", "created_at"):
        assert after[legacy][field] == before[legacy][field]
    assert len(after) == len(before)


def test_is_idempotent(tmp_path):
    _seed_with_hash("annotator1")
    from scripts.strip_password_hashes import strip

    assert len(strip(apply=True)) == 1
    assert strip(apply=False) == []
    assert strip(apply=True) == []


def test_reports_nothing_when_no_hash_exists(tmp_path):
    user_service.get_or_provision_google_user("only@x.com", None, None, UserRole.annotator)
    from scripts.strip_password_hashes import strip

    assert strip(apply=False) == []
