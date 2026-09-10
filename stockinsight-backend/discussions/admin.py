from django.contrib import admin
from .models import DiscussionPost, DiscussionReply, Vote

admin.site.register(DiscussionPost)
admin.site.register(DiscussionReply)
admin.site.register(Vote)
