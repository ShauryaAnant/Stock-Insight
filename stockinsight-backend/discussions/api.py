from __future__ import annotations

from django.db.models import Q, Sum, Value, Count, Subquery, OuterRef, IntegerField
from django.db.models.functions import Coalesce
from django.http import JsonResponse
from ninja import Router, Schema

from .models import DiscussionPost, DiscussionReply, Vote

router = Router(tags=["discussions"])

PAGE_SIZE = 20


# ─── Schemas ───────────────────────────────────────────────────────────

class CreatePostPayload(Schema):
    title: str
    body: str


class CreateReplyPayload(Schema):
    body: str
    parent_reply_id: int | None = None


class VotePayload(Schema):
    post_id: int | None = None
    reply_id: int | None = None
    value: int  # +1 or -1


# ─── Helpers ───────────────────────────────────────────────────────────

def _error(message: str, status: int = 400) -> JsonResponse:
    return JsonResponse({"error": message}, status=status)


def _serialize_user(user) -> dict:
    return {
        "id": user.pk,
        "username": user.get_username(),
    }


def _annotate_post_votes(qs, user):
    """Annotate a DiscussionPost queryset with vote counts and user's vote in bulk."""
    upvotes_sq = Vote.objects.filter(
        post=OuterRef("pk"), value=1
    ).order_by().values("post").annotate(cnt=Count("pk")).values("cnt")
    
    downvotes_sq = Vote.objects.filter(
        post=OuterRef("pk"), value=-1
    ).order_by().values("post").annotate(cnt=Count("pk")).values("cnt")
    
    reply_count_sq = DiscussionReply.objects.filter(
        post=OuterRef("pk"), parent__isnull=True
    ).order_by().values("post").annotate(cnt=Count("pk")).values("cnt")

    qs = qs.annotate(
        _upvotes=Coalesce(
            Subquery(upvotes_sq, output_field=IntegerField()), Value(0)
        ),
        _downvotes=Coalesce(
            Subquery(downvotes_sq, output_field=IntegerField()), Value(0)
        ),
        _reply_count=Coalesce(
            Subquery(reply_count_sq, output_field=IntegerField()), Value(0)
        ),
    )

    if user.is_authenticated:
        user_vote_sq = Vote.objects.filter(
            post=OuterRef("pk"), user=user
        ).values("value")[:1]
        qs = qs.annotate(
            _user_vote=Coalesce(
                Subquery(user_vote_sq, output_field=IntegerField()),
                Value(0),
            )
        )
    else:
        qs = qs.annotate(_user_vote=Value(0, output_field=IntegerField()))

    return qs


def _serialize_annotated_post(post, *, include_replies: bool = False, user=None) -> dict:
    """Serialize a post that has been annotated with _upvotes, _downvotes, etc."""
    data = {
        "id": post.pk,
        "ticker": post.ticker,
        "author": _serialize_user(post.author),
        "title": post.title,
        "body": post.body,
        "createdAt": post.created_at.isoformat(),
        "updatedAt": post.updated_at.isoformat(),
        "upvotes": getattr(post, "_upvotes", 0),
        "downvotes": abs(getattr(post, "_downvotes", 0)),
        "userVote": getattr(post, "_user_vote", 0),
        "replyCount": getattr(post, "_reply_count", 0),
    }
    if include_replies and user is not None:
        data["replies"] = _get_replies_for_post(post, user)
    return data


def _get_replies_for_post(post, user) -> list[dict]:
    """Fetch and serialize all replies for a post in 2-3 queries total."""
    upvotes_sq = Vote.objects.filter(
        reply=OuterRef("pk"), value=1
    ).order_by().values("reply").annotate(cnt=Count("pk")).values("cnt")

    downvotes_sq = Vote.objects.filter(
        reply=OuterRef("pk"), value=-1
    ).order_by().values("reply").annotate(cnt=Count("pk")).values("cnt")

    replies_qs = (
        DiscussionReply.objects.filter(post=post)
        .select_related("author")
        .annotate(
            _upvotes=Coalesce(
                Subquery(upvotes_sq, output_field=IntegerField()), Value(0)
            ),
            _downvotes=Coalesce(
                Subquery(downvotes_sq, output_field=IntegerField()), Value(0)
            ),
        )
    )

    if user.is_authenticated:
        user_vote_sq = Vote.objects.filter(
            reply=OuterRef("pk"), user=user
        ).values("value")[:1]
        replies_qs = replies_qs.annotate(
            _user_vote=Coalesce(
                Subquery(user_vote_sq, output_field=IntegerField()),
                Value(0),
            )
        )
    else:
        replies_qs = replies_qs.annotate(
            _user_vote=Value(0, output_field=IntegerField())
        )

    all_replies = list(replies_qs.order_by("created_at"))

    # Build tree in memory instead of per-reply DB queries
    reply_map: dict[int, dict] = {}
    roots: list[dict] = []

    for r in all_replies:
        node = {
            "id": r.pk,
            "postId": r.post_id,
            "parentId": r.parent_id,
            "author": _serialize_user(r.author),
            "body": r.body,
            "createdAt": r.created_at.isoformat(),
            "updatedAt": r.updated_at.isoformat(),
            "upvotes": getattr(r, "_upvotes", 0),
            "downvotes": abs(getattr(r, "_downvotes", 0)),
            "userVote": getattr(r, "_user_vote", 0),
            "children": [],
        }
        reply_map[r.pk] = node

        if r.parent_id is None:
            roots.append(node)
        else:
            parent_node = reply_map.get(r.parent_id)
            if parent_node is not None:
                parent_node["children"].append(node)
            else:
                roots.append(node)

    return roots


def _quick_vote_counts(*, post=None, reply=None) -> dict:
    """Single query to get vote counts for one target (used after vote mutations)."""
    qs = Vote.objects.none()
    if post is not None:
        qs = Vote.objects.filter(post=post)
    elif reply is not None:
        qs = Vote.objects.filter(reply=reply)
    agg = qs.aggregate(
        up=Coalesce(Sum("value", filter=Q(value=1)), Value(0)),
        down=Coalesce(Sum("value", filter=Q(value=-1)), Value(0)),
    )
    return {"upvotes": agg["up"], "downvotes": abs(agg["down"])}


# ─── Endpoints ─────────────────────────────────────────────────────────

# Static routes MUST come before dynamic /{ticker} routes,
# otherwise "vote" and "reply" get matched as ticker names.

@router.post("/vote")
def vote(request, payload: VotePayload):
    """Upvote or downvote a post or reply (auth required, toggleable)."""
    if not request.user.is_authenticated:
        return _error("You must be logged in to vote.", status=401)

    if payload.value not in (1, -1):
        return _error("Vote value must be 1 or -1.")

    if payload.post_id is not None:
        try:
            target_post = DiscussionPost.objects.get(pk=payload.post_id)
        except DiscussionPost.DoesNotExist:
            return _error("Post not found.", status=404)

        existing = Vote.objects.filter(user=request.user, post=target_post).first()
        if existing:
            if existing.value == payload.value:
                existing.delete()
                counts = _quick_vote_counts(post=target_post)
                return {"removed": True, **counts, "userVote": 0}
            else:
                existing.value = payload.value
                existing.save()
                counts = _quick_vote_counts(post=target_post)
                return {**counts, "userVote": payload.value}
        else:
            Vote.objects.create(user=request.user, post=target_post, value=payload.value)
            counts = _quick_vote_counts(post=target_post)
            return {**counts, "userVote": payload.value}

    elif payload.reply_id is not None:
        try:
            target_reply = DiscussionReply.objects.get(pk=payload.reply_id)
        except DiscussionReply.DoesNotExist:
            return _error("Reply not found.", status=404)

        existing = Vote.objects.filter(user=request.user, reply=target_reply).first()
        if existing:
            if existing.value == payload.value:
                existing.delete()
                counts = _quick_vote_counts(reply=target_reply)
                return {"removed": True, **counts, "userVote": 0}
            else:
                existing.value = payload.value
                existing.save()
                counts = _quick_vote_counts(reply=target_reply)
                return {**counts, "userVote": payload.value}
        else:
            Vote.objects.create(user=request.user, reply=target_reply, value=payload.value)
            counts = _quick_vote_counts(reply=target_reply)
            return {**counts, "userVote": payload.value}

    return _error("Either post_id or reply_id is required.")


@router.delete("/reply/{reply_id}")
def delete_reply(request, reply_id: int):
    """Delete own reply (auth required)."""
    if not request.user.is_authenticated:
        return _error("You must be logged in.", status=401)

    try:
        reply = DiscussionReply.objects.get(pk=reply_id)
    except DiscussionReply.DoesNotExist:
        return _error("Reply not found.", status=404)

    if reply.author_id != request.user.pk:
        return _error("You can only delete your own replies.", status=403)

    reply.delete()
    return {"success": True}


# Dynamic routes — /{ticker} patterns come AFTER static routes

@router.get("/{ticker}")
def list_posts(request, ticker: str, page: int = 1, sort: str = "newest"):
    """List discussion posts for a given ticker — single annotated query."""
    ticker = ticker.strip().upper()
    qs = DiscussionPost.objects.filter(ticker=ticker).select_related("author")
    qs = _annotate_post_votes(qs, request.user)

    if sort == "top":
        qs = qs.order_by("-_upvotes", "-created_at")
    else:
        qs = qs.order_by("-created_at")

    total = qs.count()
    offset = (max(page, 1) - 1) * PAGE_SIZE
    posts = list(qs[offset: offset + PAGE_SIZE])

    return {
        "ticker": ticker,
        "posts": [_serialize_annotated_post(p) for p in posts],
        "total": total,
        "page": page,
        "pageSize": PAGE_SIZE,
        "totalPages": max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE),
    }


@router.post("/{ticker}")
def create_post(request, ticker: str, payload: CreatePostPayload):
    """Create a new discussion post (auth required)."""
    if not request.user.is_authenticated:
        return _error("You must be logged in to post.", status=401)

    title = payload.title.strip()
    body = payload.body.strip()
    if not title:
        return _error("Title is required.")
    if not body:
        return _error("Body is required.")
    if len(title) > 200:
        return _error("Title must be 200 characters or fewer.")

    post = DiscussionPost.objects.create(
        ticker=ticker.strip().upper(),
        author=request.user,
        title=title,
        body=body,
    )
    return JsonResponse({
        "id": post.pk,
        "ticker": post.ticker,
        "author": _serialize_user(post.author),
        "title": post.title,
        "body": post.body,
        "createdAt": post.created_at.isoformat(),
        "updatedAt": post.updated_at.isoformat(),
        "upvotes": 0,
        "downvotes": 0,
        "userVote": 0,
        "replyCount": 0,
    }, status=201)


@router.get("/{ticker}/{post_id}")
def get_post(request, ticker: str, post_id: int):
    """Get a single post with its replies — 2-3 queries total."""
    ticker = ticker.strip().upper()
    qs = DiscussionPost.objects.filter(pk=post_id, ticker=ticker).select_related("author")
    qs = _annotate_post_votes(qs, request.user)

    post = qs.first()
    if post is None:
        return _error("Post not found.", status=404)

    return _serialize_annotated_post(post, include_replies=True, user=request.user)


@router.post("/{ticker}/{post_id}/reply")
def create_reply(request, ticker: str, post_id: int, payload: CreateReplyPayload):
    """Reply to a post (auth required)."""
    if not request.user.is_authenticated:
        return _error("You must be logged in to reply.", status=401)

    body = payload.body.strip()
    if not body:
        return _error("Reply body is required.")

    try:
        post = DiscussionPost.objects.get(pk=post_id, ticker=ticker.strip().upper())
    except DiscussionPost.DoesNotExist:
        return _error("Post not found.", status=404)

    parent = None
    if payload.parent_reply_id is not None:
        try:
            parent = DiscussionReply.objects.get(pk=payload.parent_reply_id, post=post)
        except DiscussionReply.DoesNotExist:
            return _error("Parent reply not found.", status=404)

    reply = DiscussionReply.objects.create(
        post=post,
        parent=parent,
        author=request.user,
        body=body,
    )
    return JsonResponse({
        "id": reply.pk,
        "postId": reply.post_id,
        "parentId": reply.parent_id,
        "author": _serialize_user(reply.author),
        "body": reply.body,
        "createdAt": reply.created_at.isoformat(),
        "updatedAt": reply.updated_at.isoformat(),
        "upvotes": 0,
        "downvotes": 0,
        "userVote": 0,
        "children": [],
    }, status=201)


@router.delete("/{ticker}/{post_id}")
def delete_post(request, ticker: str, post_id: int):
    """Delete own post (auth required)."""
    if not request.user.is_authenticated:
        return _error("You must be logged in.", status=401)

    try:
        post = DiscussionPost.objects.get(pk=post_id, ticker=ticker.strip().upper())
    except DiscussionPost.DoesNotExist:
        return _error("Post not found.", status=404)

    if post.author_id != request.user.pk:
        return _error("You can only delete your own posts.", status=403)

    post.delete()
    return {"success": True}
