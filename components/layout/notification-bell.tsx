'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase-config';
import {
  getNotificationActionLink, subscribeToNotifications, markNotificationAsRead,
  type NotificationRecord,
} from '@/lib/notification-service';
import { cn } from '@/lib/utils';

export function NotificationBell() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  useEffect(() => {
    if (!user?.uid || !isFirebaseConfigured()) return;
    return subscribeToNotifications(user.uid, setNotifications, undefined, 15, profile?.role);
  }, [profile?.role, user?.uid]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleClick = async (n: NotificationRecord) => {
    if (!n.isRead && n.id && user) {
      await markNotificationAsRead(n.id, {
        id: user.uid,
        name: profile?.full_name || profile?.email || 'User',
      });
    }
    router.push(getNotificationActionLink(n));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 relative"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {unreadCount > 0 && <Badge variant="destructive" className="text-xs">{unreadCount} new</Badge>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <DropdownMenuItem disabled className="text-center text-muted-foreground">No notifications</DropdownMenuItem>
        ) : (
          notifications.slice(0, 8).map((n) => (
            <DropdownMenuItem
              key={n.id}
              className={cn('flex flex-col items-start gap-0.5 py-2.5 cursor-pointer', !n.isRead && 'bg-muted/50')}
              onClick={() => handleClick(n)}
            >
              <div className="flex items-center justify-between w-full gap-2">
                <span className="text-sm font-medium truncate">{n.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {n.createdAt ? formatDistanceToNow(new Date(n.createdAt), { addSuffix: true }) : ''}
                </span>
              </div>
              <span className="text-xs text-muted-foreground line-clamp-2">{n.message}</span>
              <span className="text-[10px] text-muted-foreground">{n.moduleName}{n.documentNumber ? ` · ${n.documentNumber}` : ''}</span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-center text-sm text-primary justify-center" asChild>
          <Link href="/notifications">View all notifications</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
