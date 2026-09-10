from django.conf import settings
from django.db import models


class DiscussionPost(models.Model):
    """A top-level discussion thread tied to a stock ticker."""

    ticker = models.CharField(max_length=20, db_index=True)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="discussion_posts",
    )
    title = models.CharField(max_length=200)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["ticker", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"[{self.ticker}] {self.title}"


class DiscussionReply(models.Model):
    """A reply to a discussion post. Supports one level of nesting."""

    post = models.ForeignKey(
        DiscussionPost,
        on_delete=models.CASCADE,
        related_name="replies",
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="discussion_replies",
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"Reply by {self.author} on {self.post}"


class Vote(models.Model):
    """Tracks upvotes (+1) and downvotes (-1) for posts and replies."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="discussion_votes",
    )
    post = models.ForeignKey(
        DiscussionPost,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="votes",
    )
    reply = models.ForeignKey(
        DiscussionReply,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="votes",
    )
    value = models.SmallIntegerField()  # +1 or -1

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "post"],
                condition=models.Q(post__isnull=False),
                name="unique_user_post_vote",
            ),
            models.UniqueConstraint(
                fields=["user", "reply"],
                condition=models.Q(reply__isnull=False),
                name="unique_user_reply_vote",
            ),
        ]

    def __str__(self) -> str:
        target = self.post or self.reply
        return f"Vote({self.value}) by {self.user} on {target}"
