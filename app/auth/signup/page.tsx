'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/auth-context';

const schema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirm_password: z.string(),
  role: z.string().min(1, 'Please select a role'),
}).refine(d => d.password === d.confirm_password, { message: 'Passwords do not match', path: ['confirm_password'] });

type FormData = z.infer<typeof schema>;

const roles = [
  { value: 'qa', label: 'QA (Quality Assurance)' },
  { value: 'qc', label: 'QC (Quality Control)' },
  { value: 'production', label: 'Production' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'regulatory', label: 'Regulatory Affairs' },
  { value: 'viewer', label: 'Viewer (Read Only)' },
];

export default function SignupPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState('');
  const { signUp, signOut } = useAuth();
  const router = useRouter();

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      const { error } = await signUp(data.email, data.password, data.full_name, data.role);
      if (error) {
        toast.error('Registration failed', { description: error.message });
        return;
      }
      await signOut();
      toast.success('Access request submitted', {
        description: 'An administrator must approve and activate your account before you can sign in.',
      });
      router.push('/auth/login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 overflow-hidden rounded-2xl shadow-lg mb-4">
            <Image
              src="/logo-1.png"
              alt="Skymap Pharmaceuticals"
              width={56}
              height={56}
              className="h-14 w-14 object-contain"
              priority
            />
          </div>
          <h1 className="text-2xl font-bold text-white">Request Access</h1>
          <p className="text-slate-400 text-sm">SKYMAP QMS Enterprise Platform</p>
        </div>

        <Card className="border-slate-700/50 bg-slate-800/60 backdrop-blur-xl shadow-2xl">
          <CardContent className="p-8">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Full Name</Label>
                <Input {...register('full_name')} placeholder="Dr. Jane Smith" className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 h-10" />
                {errors.full_name && <p className="text-red-400 text-xs">{errors.full_name.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Email Address</Label>
                <Input {...register('email')} type="email" placeholder="name@company.com" className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 h-10" />
                {errors.email && <p className="text-red-400 text-xs">{errors.email.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Department Role</Label>
                <Select onValueChange={(v) => { setSelectedRole(v); setValue('role', v); }}>
                  <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white h-10">
                    <SelectValue placeholder="Select your role" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600">
                    {roles.map(r => (
                      <SelectItem key={r.value} value={r.value} className="text-white hover:bg-slate-700">
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.role && <p className="text-red-400 text-xs">{errors.role.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Password</Label>
                <div className="relative">
                  <Input {...register('password')} type={showPassword ? 'text' : 'password'} placeholder="Min. 8 characters" className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 h-10 pr-10" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-red-400 text-xs">{errors.password.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Confirm Password</Label>
                <Input {...register('confirm_password')} type="password" placeholder="Repeat password" className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 h-10" />
                {errors.confirm_password && <p className="text-red-400 text-xs">{errors.confirm_password.message}</p>}
              </div>

              <Button type="submit" disabled={loading} className="w-full h-10 bg-blue-600 hover:bg-blue-500 text-white font-semibold mt-2">
                {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating Account...</> : <><UserPlus className="h-4 w-4 mr-2" />Create Account</>}
              </Button>
            </form>

            <p className="text-center text-slate-500 text-xs mt-5">
              Already have an account?{' '}
              <Link href="/auth/login" className="text-blue-400 hover:text-blue-300">Sign In</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
