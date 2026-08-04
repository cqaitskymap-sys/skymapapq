'use client';

import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  subscribeToNotifications,
  markAllNotificationsRead,
  clearAllNotifications,
  type NotificationRecord,
} from '@/lib/notification-service';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { PriorityBadge } from '@/components/admin/notifications/priority-badge';
import { canDeleteRecords } from '@/lib/permissions';

export default function NotificationsPage() {
  const { user, profile } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const canClearAll = canDeleteRecords(profile?.role);

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }
    if (!isFirebaseConfigured()) {
      setError('Firebase is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeToNotifications(user.uid, (data) => {
      setNotifications(data);
      setLoading(false);
    }, (err) => {
      setError(err.message);
      setLoading(false);
    }, 50, profile?.role);
    return () => unsub();
  }, [profile?.role, user?.uid]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleMarkAllRead = async () => {
    if (!user?.uid) return;
    const ok = await markAllNotificationsRead(user.uid, {
      id: user.uid,
      name: profile?.full_name || profile?.email || 'User',
    }, profile?.role);
    if (ok) toast.success('All notifications marked as read');
    else toast.error('Failed to update notifications');
  };

  const handleClearAll = async () => {
    if (!user?.uid || !canClearAll) return;
    if (!window.confirm('Permanently delete all notifications? This cannot be undone.')) return;
    setClearing(true);
    const result = await clearAllNotifications({
      id: user.uid,
      name: profile?.full_name || profile?.email || 'User',
      role: profile?.role,
    });
    setClearing(false);
    if (result.success) toast.success(`Cleared ${result.deleted} notifications`);
    else toast.error(result.error || 'Failed to clear notifications');
  };

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error) return <ErrorCard message={error} onRetry={() => window.location.reload()} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">In-app alerts, approvals, and workflow reminders</p>
        </div>
        <div className="flex items-center gap-2">
          {canClearAll && notifications.length > 0 && (
            <Button variant="destructive" onClick={handleClearAll} disabled={clearing}>
              {clearing ? 'Clearing…' : 'Clear All'}
            </Button>
          )}
          {unreadCount > 0 && (
            <Button variant="outline" onClick={handleMarkAllRead}>Mark All as Read</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total</p><p className="text-2xl font-bold">{notifications.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Unread</p><p className="text-2xl font-bold">{unreadCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Critical</p><p className="text-2xl font-bold">{notifications.filter((n) => n.priority === 'Critical').length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Failed</p><p className="text-2xl font-bold">{notifications.filter((n) => n.sentStatus === 'Failed').length}</p></CardContent></Card>
      </div>

      {notifications.length === 0 ? (
        <EmptyState title="No notifications" message="You are all caught up." />
      ) : (
        <div className="space-y-2">
          {notifications.map((notif) => (
            <Card key={notif.id} className={notif.isRead ? 'opacity-70' : ''}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3 flex-1">
                    <Bell className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Link href={`/notifications/${notif.id}`} className="font-semibold hover:underline">{notif.title}</Link>
                        <Badge variant="outline" className="text-xs">{notif.moduleName}</Badge>
                        <PriorityBadge priority={notif.priority} />
                        {!notif.isRead && <Badge className="text-xs">Unread</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{notif.message}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {notif.createdAt ? formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true }) : ''}
                      </p>
                    </div>
                  </div>
                  {!notif.isRead && notif.id && (
                    <Button variant="ghost" size="icon" asChild>
                      <Link href={`/notifications/${notif.id}`}><CheckCircle className="h-4 w-4" /></Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
