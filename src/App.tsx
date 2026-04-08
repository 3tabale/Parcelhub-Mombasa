import React, { useState, useEffect, useRef } from 'react';
import { 
  Package, 
  Search, 
  Truck, 
  User, 
  LayoutDashboard, 
  Settings, 
  MapPin, 
  Lock, 
  Plus, 
  LogOut, 
  LogIn, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Image as ImageIcon,
  Loader2,
  ChevronRight,
  Phone,
  Mail,
  Navigation,
  Menu,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  getDoc, 
  setDoc, 
  serverTimestamp, 
  orderBy,
  getDocFromServer
} from 'firebase/firestore';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import Markdown from 'react-markdown';
import { QRCodeSVG } from 'qrcode.react';

import { auth, db } from './firebase';
import { cn } from './lib/utils';

// --- Types ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't necessarily want to crash the whole app, but we want it logged.
  // In a real app, you might show a toast.
}

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: 'client' | 'courier' | 'admin';
  phone?: string;
  defaultPickup?: string;
  defaultDelivery?: string;
  createdAt: any;
}

interface Parcel {
  id: string;
  trackingNumber: string;
  senderUid: string;
  recipientName: string;
  recipientPhone: string;
  pickupAddress: string;
  deliveryAddress: string;
  status: 'pending' | 'picked-up' | 'sorting' | 'in-transit' | 'delivered' | 'issue';
  weight: number;
  serviceType: string;
  courierUid?: string;
  createdAt: any;
  updatedAt: any;
  history: any[];
}

interface Locker {
  id: string;
  locationName: string;
  address: string;
  compartments: { id: string; status: 'available' | 'occupied' | 'maintenance' }[];
}

// --- Constants ---

const ROLES = ['client', 'courier', 'admin'] as const;
const GEMINI_MODEL = "gemini-3-flash-preview";
const IMAGE_MODEL = "gemini-3.1-flash-image-preview";

// --- Components ---

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error) errorMessage = parsed.error;
      } catch (e) {
        if (this.state.error?.message) errorMessage = this.state.error.message;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
          <Card className="max-w-md w-full text-center space-y-4 border-red-200">
            <AlertCircle className="w-12 h-12 text-red-600 mx-auto" />
            <h2 className="text-xl font-bold text-gray-900">Application Error</h2>
            <p className="text-gray-600">{errorMessage}</p>
            <Button onClick={() => window.location.reload()} variant="danger" className="w-full">
              Reload Application
            </Button>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

const Button = ({ className, variant = 'primary', size = 'md', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger', size?: 'sm' | 'md' | 'lg' | 'icon' }) => {
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md hover:shadow-lg',
    secondary: 'bg-purple-600 text-white hover:bg-purple-700 shadow-md hover:shadow-lg',
    outline: 'border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50',
    ghost: 'text-gray-600 hover:bg-gray-100',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-md hover:shadow-lg',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
    icon: 'p-2',
  };
  return (
    <button 
      className={cn('rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2', variants[variant], sizes[size], className)} 
      {...props} 
    />
  );
};

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('bg-white rounded-2xl shadow-sm border border-gray-100 p-6', className)}>
    {children}
  </div>
);

const Input = ({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) => (
  <div className="space-y-1.5">
    {label && <label className="text-sm font-semibold text-gray-700">{label}</label>}
    <input 
      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all bg-gray-50/50" 
      {...props} 
    />
  </div>
);

const Select = ({ label, options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; options: { value: string; label: string }[] }) => (
  <div className="space-y-1.5">
    {label && <label className="text-sm font-semibold text-gray-700">{label}</label>}
    <select 
      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all bg-gray-50/50" 
      {...props}
    >
      {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
  </div>
);

// --- Main App Component ---

const NAV_ITEMS = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['client', 'courier', 'admin'] },
  { id: 'history', icon: Clock, label: 'Order History', roles: ['client', 'courier', 'admin'] },
  { id: 'booking', icon: Plus, label: 'Book Parcel', roles: ['client'] },
  { id: 'tracking', icon: Search, label: 'Track Parcel', roles: ['client'] },
  { id: 'lockers', icon: Lock, label: 'Smart Lockers', roles: ['client', 'courier', 'admin'] },
  { id: 'ai-assistant', icon: Navigation, label: 'Route Assistant', roles: ['courier', 'admin'] },
  { id: 'image-gen', icon: ImageIcon, label: 'Label Designer', roles: ['client', 'admin'] },
  { id: 'courier', icon: Truck, label: 'Courier Portal', roles: ['courier'] },
  { id: 'admin', icon: Settings, label: 'Admin Panel', roles: ['admin'] },
];

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [lockers, setLockers] = useState<Locker[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackedParcel, setTrackedParcel] = useState<Parcel | null>(null);
  const [aiResponse, setAiResponse] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [imagePrompt, setImagePrompt] = useState('');
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [lockerSearch, setLockerSearch] = useState('');
  const [selectedLocker, setSelectedLocker] = useState<Locker | null>(null);
  const [reservationConfirmation, setReservationConfirmation] = useState<{
    locker: Locker;
    code: string;
    compartmentId: string;
  } | null>(null);

  useEffect(() => {
    if (profile?.role === 'admin' && activeTab === 'admin') {
      const q = query(collection(db, 'users'), orderBy('name'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const usersData = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
        setUsersList(usersData);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
      });
      return () => unsubscribe();
    }
  }, [profile, activeTab]);

  const updateUserRole = async (userId: string, newRole: UserProfile['role']) => {
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, { role: newRole });
      // If updating self, update local profile state
      if (userId === user?.uid) {
        setProfile(prev => prev ? { ...prev, role: newRole } : null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  const switchRole = async (newRole: UserProfile['role']) => {
    if (!user || !profile) return;
    try {
      const profileRef = doc(db, 'users', user.uid);
      await updateDoc(profileRef, { role: newRole });
      setProfile({ ...profile, role: newRole });
      // Reset to dashboard when switching roles to avoid tab mismatches
      setActiveTab('dashboard');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'users');
    }
  };

  // --- Auth & Profile ---

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (profileDoc.exists()) {
          setProfile(profileDoc.data() as UserProfile);
        } else {
          // Create default profile
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            name: firebaseUser.displayName || 'Anonymous User',
            email: firebaseUser.email || '',
            role: 'client',
            createdAt: serverTimestamp(),
          };
          await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
          setProfile(newProfile);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    // Test Firestore connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setActiveTab('dashboard');
  };

  // --- Data Fetching ---

  useEffect(() => {
    if (!user) {
      setParcels([]);
      return;
    }

    let q;
    if (profile?.role === 'admin') {
      q = query(collection(db, 'parcels'), orderBy('createdAt', 'desc'));
    } else if (profile?.role === 'courier') {
      q = query(collection(db, 'parcels'), where('courierUid', '==', user.uid), orderBy('createdAt', 'desc'));
    } else {
      q = query(collection(db, 'parcels'), where('senderUid', '==', user.uid), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const parcelData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Parcel));
      setParcels(parcelData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'parcels');
    });

    return () => unsubscribe();
  }, [user, profile]);

  useEffect(() => {
    if (!user) return;
    
    const unsubscribe = onSnapshot(collection(db, 'lockers'), (snapshot) => {
      const lockerData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Locker));
      setLockers(lockerData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'lockers');
    });
    return () => unsubscribe();
  }, [user]);

  // --- AI Features ---

  const askGemini = async (prompt: string) => {
    setIsAiLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      // Get user location for grounding
      let locationContext = "";
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej));
        locationContext = `User current location: ${pos.coords.latitude}, ${pos.coords.longitude}. `;
      } catch (e) {
        console.warn("Geolocation denied");
      }

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `${locationContext}${prompt}`,
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: {
                latitude: -4.0435, // Mombasa default
                longitude: 39.6682
              }
            }
          }
        },
      });
      setAiResponse(response.text || "No response from AI.");
    } catch (error) {
      console.error("Gemini Error", error);
      setAiResponse("Sorry, I encountered an error while processing your request.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const generateImage = async () => {
    if (!imagePrompt) return;
    setIsImageLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: {
          parts: [{ text: `Create a professional parcel delivery label or promotional graphic for: ${imagePrompt}` }]
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: "1K"
          }
        }
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          setGeneratedImage(`data:image/png;base64,${part.inlineData.data}`);
          break;
        }
      }
    } catch (error) {
      console.error("Image Gen Error", error);
    } finally {
      setIsImageLoading(false);
    }
  };

  // --- Actions ---

  const bookParcel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.target as HTMLFormElement);
    const trackingNum = `PK-${Date.now().toString().slice(-6)}`;
    
    const newParcel = {
      trackingNumber: trackingNum,
      senderUid: user.uid,
      recipientName: formData.get('recipientName'),
      recipientPhone: formData.get('recipientPhone'),
      pickupAddress: formData.get('pickupAddress'),
      deliveryAddress: formData.get('deliveryAddress'),
      status: 'pending',
      weight: Number(formData.get('weight')),
      serviceType: formData.get('serviceType'),
      paymentMethod: formData.get('paymentMethod'),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      history: [{ status: 'pending', time: new Date().toISOString(), note: 'Parcel booked' }]
    };

    try {
      await addDoc(collection(db, 'parcels'), newParcel);
      setActiveTab('dashboard');
      alert(`Parcel booked! Tracking ID: ${trackingNum}`);
    } catch (error) {
      console.error("Booking error", error);
    }
  };

  const seedLockers = async () => {
    if (lockers.length > 0) return;
    const initialLockers = [
      {
        locationName: "TUM Main Campus",
        address: "Tom Mboya St, Mombasa (Near Library)",
        compartments: [
          { id: "A1", status: "available" }, { id: "A2", status: "occupied" },
          { id: "A3", status: "available" }, { id: "A4", status: "available" },
          { id: "B1", status: "maintenance" }, { id: "B2", status: "available" },
          { id: "B3", status: "occupied" }, { id: "B4", status: "available" },
          { id: "C1", status: "available" }, { id: "C2", status: "available" },
          { id: "C3", status: "available" }, { id: "C4", status: "available" },
        ]
      },
      {
        locationName: "Mvita Market",
        address: "Jomo Kenyatta Ave, Mombasa",
        compartments: [
          { id: "L1", status: "available" }, { id: "L2", status: "available" },
          { id: "L3", status: "occupied" }, { id: "L4", status: "available" },
          { id: "L5", status: "available" }, { id: "L6", status: "maintenance" },
          { id: "L7", status: "available" }, { id: "L8", status: "available" },
        ]
      },
      {
        locationName: "Coast General Hospital",
        address: "Kisauni Rd, Mombasa (Visitor Parking)",
        compartments: [
          { id: "H1", status: "available" }, { id: "H2", status: "available" },
          { id: "H3", status: "occupied" }, { id: "H4", status: "available" },
          { id: "H5", status: "available" }, { id: "H6", status: "available" },
          { id: "H7", status: "available" }, { id: "H8", status: "available" },
        ]
      }
    ];

    try {
      for (const locker of initialLockers) {
        await addDoc(collection(db, 'lockers'), locker);
      }
      alert("Lockers seeded successfully!");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'lockers');
    }
  };

  const updateParcelStatus = async (parcelId: string, newStatus: Parcel['status']) => {
    try {
      const parcelRef = doc(db, 'parcels', parcelId);
      const parcelSnap = await getDoc(parcelRef);
      if (parcelSnap.exists()) {
        const history = parcelSnap.data().history || [];
        await updateDoc(parcelRef, {
          status: newStatus,
          updatedAt: serverTimestamp(),
          history: [...history, { status: newStatus, time: new Date().toISOString(), note: `Status updated to ${newStatus}` }]
        });
      }
    } catch (error) {
      console.error("Update error", error);
    }
  };

  // --- Render Helpers ---

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-indigo-50">
        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center space-y-6"
        >
          <div className="w-20 h-20 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto">
            <Package className="w-10 h-10 text-indigo-600" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-gray-900">ParcelHub Mombasa</h1>
            <p className="text-gray-500">Your trusted e-commerce logistics partner in Mvita.</p>
          </div>
          <Button onClick={handleLogin} className="w-full py-4 text-lg">
            <LogIn className="w-5 h-5" />
            Sign in with Google
          </Button>
          <p className="text-xs text-gray-400">By signing in, you agree to our Terms of Service.</p>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-gray-50 overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-100 flex items-center justify-between px-4 z-40">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Package className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-gray-900">ParcelHub</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </Button>
        </header>

        {/* Sidebar Overlay */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="md:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <aside className={cn(
          "fixed md:static inset-y-0 left-0 w-72 bg-white border-r border-gray-100 flex flex-col z-50 transition-transform duration-300 transform md:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="p-6 flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <Package className="w-6 h-6 text-white" />
            </div>
            <span className="font-bold text-xl text-gray-900">ParcelHub</span>
          </div>

          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {NAV_ITEMS
            .filter(item => item.roles.includes(profile?.role || 'client'))
            .map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setIsSidebarOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all",
                  activeTab === item.id 
                    ? "bg-indigo-50 text-indigo-600" 
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </button>
            ))}
          </nav>

          {/* Role Switcher (Demo Only) */}
          <div className="px-4 py-4 border-t border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-2">Demo Role Switcher</p>
            <div className="grid grid-cols-3 gap-1 bg-gray-50 p-1 rounded-xl">
              <button 
                onClick={() => switchRole('client')}
                className={cn("py-1.5 text-[10px] font-bold rounded-lg transition-all", profile?.role === 'client' ? "bg-white shadow-sm text-indigo-600" : "text-gray-400 hover:text-gray-600")}
              >
                Client
              </button>
              <button 
                onClick={() => switchRole('courier')}
                className={cn("py-1.5 text-[10px] font-bold rounded-lg transition-all", profile?.role === 'courier' ? "bg-white shadow-sm text-indigo-600" : "text-gray-400 hover:text-gray-600")}
              >
                Courier
              </button>
              <button 
                onClick={() => switchRole('admin')}
                className={cn("py-1.5 text-[10px] font-bold rounded-lg transition-all", profile?.role === 'admin' ? "bg-white shadow-sm text-indigo-600" : "text-gray-400 hover:text-gray-600")}
              >
                Admin
              </button>
            </div>
          </div>

          <div className="p-4 border-t border-gray-100">
            <div className="flex items-center gap-3 px-4 py-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                <User className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{profile?.name}</p>
                <p className="text-xs text-gray-500 truncate capitalize">{profile?.role}</p>
              </div>
            </div>
            <Button variant="ghost" onClick={handleLogout} className="w-full justify-start text-red-600 hover:bg-red-50">
              <LogOut className="w-4 h-4" />
              Sign Out
            </Button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 pt-20 lg:pt-8 pb-24 lg:pb-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-6xl mx-auto"
            >
              {activeTab === 'dashboard' && (
                <div className="space-y-8">
                  <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h1 className="text-3xl font-bold text-gray-900">Welcome back, {profile?.name.split(' ')[0]}!</h1>
                      <p className="text-gray-500">Here's what's happening with your parcels today.</p>
                    </div>
                    <Button onClick={() => setActiveTab('booking')}>
                      <Plus className="w-5 h-5" />
                      New Booking
                    </Button>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Card className="bg-indigo-600 text-white">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-indigo-100 text-sm font-medium">Active Shipments</p>
                          <h3 className="text-4xl font-bold mt-1">{parcels.filter(p => p.status !== 'delivered').length}</h3>
                        </div>
                        <div className="p-3 bg-white/10 rounded-xl">
                          <Truck className="w-6 h-6" />
                        </div>
                      </div>
                    </Card>
                    <Card>
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-gray-500 text-sm font-medium">Delivered Total</p>
                          <h3 className="text-4xl font-bold text-gray-900 mt-1">{parcels.filter(p => p.status === 'delivered').length}</h3>
                        </div>
                        <div className="p-3 bg-green-50 rounded-xl">
                          <CheckCircle2 className="w-6 h-6 text-green-600" />
                        </div>
                      </div>
                    </Card>
                    <Card>
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-gray-500 text-sm font-medium">Smart Lockers</p>
                          <h3 className="text-4xl font-bold text-gray-900 mt-1">{lockers.length}</h3>
                        </div>
                        <div className="p-3 bg-purple-50 rounded-xl">
                          <Lock className="w-6 h-6 text-purple-600" />
                        </div>
                      </div>
                    </Card>
                  </div>

                  <div className="space-y-4">
                    <h2 className="text-xl font-bold text-gray-900">Recent Shipments</h2>
                    {parcels.length > 0 ? (
                      <div className="grid gap-4">
                        {parcels.slice(0, 5).map(parcel => (
                          <Card key={parcel.id} className="hover:border-indigo-200 transition-colors cursor-pointer group">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                              <div className="flex items-center gap-4">
                                <div className={cn(
                                  "w-12 h-12 rounded-xl flex items-center justify-center",
                                  parcel.status === 'delivered' ? "bg-green-50 text-green-600" : "bg-indigo-50 text-indigo-600"
                                )}>
                                  <Package className="w-6 h-6" />
                                </div>
                                <div>
                                  <p className="font-bold text-gray-900">{parcel.trackingNumber}</p>
                                  <p className="text-sm text-gray-500">To: {parcel.recipientName}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-8">
                                <div className="text-right hidden md:block">
                                  <p className="text-sm font-semibold text-gray-900 capitalize">{parcel.status.replace('-', ' ')}</p>
                                  <p className="text-xs text-gray-500">{new Date(parcel.updatedAt?.seconds * 1000).toLocaleDateString()}</p>
                                </div>
                                <span className={cn(
                                  "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                                  parcel.status === 'delivered' ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                                )}>
                                  {parcel.status}
                                </span>
                                <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-indigo-600 transition-colors" />
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-200">
                        <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500">No parcels found. Start by booking one!</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'history' && (
                <div className="space-y-8">
                  <header>
                    <h1 className="text-3xl font-bold text-gray-900">Order History</h1>
                    <p className="text-gray-500">View all your past and current parcel bookings.</p>
                  </header>

                  <Card className="overflow-hidden p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Tracking Number</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Recipient</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Date</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Status</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {parcels.length > 0 ? (
                            parcels.map((parcel) => (
                              <tr key={parcel.id} className="hover:bg-gray-50/50 transition-colors">
                                <td className="px-6 py-4">
                                  <span className="font-mono font-bold text-indigo-600">{parcel.trackingNumber}</span>
                                </td>
                                <td className="px-6 py-4">
                                  <p className="text-sm font-bold text-gray-900">{parcel.recipientName}</p>
                                  <p className="text-xs text-gray-500">{parcel.recipientPhone}</p>
                                </td>
                                <td className="px-6 py-4">
                                  <p className="text-sm text-gray-700">
                                    {parcel.createdAt?.seconds 
                                      ? new Date(parcel.createdAt.seconds * 1000).toLocaleDateString() 
                                      : 'Recently'}
                                  </p>
                                </td>
                                <td className="px-6 py-4">
                                  <span className={cn(
                                    "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                    parcel.status === 'delivered' ? "bg-green-100 text-green-700" : 
                                    parcel.status === 'issue' ? "bg-red-100 text-red-700" :
                                    "bg-yellow-100 text-yellow-700"
                                  )}>
                                    {parcel.status.replace('-', ' ')}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <Button 
                                    variant="ghost" 
                                    onClick={() => {
                                      setTrackingNumber(parcel.trackingNumber);
                                      setActiveTab('tracking');
                                    }}
                                  >
                                    Track
                                  </Button>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                                No orders found in your history.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>
              )}

              {activeTab === 'booking' && (
                <div className="max-w-2xl mx-auto space-y-8">
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">Book a Parcel</h1>
                    <p className="text-gray-500">Fill in the details to schedule your delivery.</p>
                  </div>

                  <form onSubmit={bookParcel} className="space-y-6">
                    <Card className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Input name="recipientName" label="Recipient Name" required placeholder="e.g. John Doe" />
                        <Input name="recipientPhone" label="Recipient Phone" required placeholder="e.g. 0712345678" />
                      </div>
                      <Input name="pickupAddress" label="Pickup Address" required placeholder="e.g. TUM Main Campus, Mvita" />
                      <Input name="deliveryAddress" label="Delivery Address" required placeholder="e.g. Mvita Market, Mombasa" />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Input name="weight" label="Weight (kg)" type="number" step="0.1" required />
                        <Select 
                          name="serviceType" 
                          label="Service Type" 
                          options={[
                            { value: 'standard', label: 'Standard (2-3 days)' },
                            { value: 'express', label: 'Express (24 hours)' },
                            { value: 'same-day', label: 'Same Day' },
                            { value: 'locker', label: 'Smart Locker Delivery' },
                          ]} 
                        />
                      </div>
                      <Select 
                        name="paymentMethod" 
                        label="Payment Method" 
                        required
                        options={[
                          { value: 'mpesa', label: 'M-Pesa' },
                          { value: 'cash', label: 'Cash on Delivery' },
                          { value: 'bank', label: 'Bank Transfer' },
                          { value: 'paypal', label: 'PayPal' },
                        ]} 
                      />
                    </Card>
                    <Button type="submit" className="w-full py-4 text-lg">
                      Confirm Booking
                    </Button>
                  </form>
                </div>
              )}

              {activeTab === 'tracking' && (
                <div className="max-w-2xl mx-auto space-y-8">
                  <div className="text-center space-y-4">
                    <h1 className="text-3xl font-bold text-gray-900">Track Your Parcel</h1>
                    <p className="text-gray-500">Enter your tracking number to see real-time updates.</p>
                    <div className="flex gap-2">
                      <Input 
                        value={trackingNumber} 
                        onChange={(e) => setTrackingNumber(e.target.value)}
                        placeholder="Enter Tracking Number (e.g. PK-123456)" 
                        className="flex-1"
                      />
                      <Button onClick={() => {
                        const p = parcels.find(p => p.trackingNumber === trackingNumber);
                        setTrackedParcel(p || null);
                      }}>
                        <Search className="w-5 h-5" />
                        Track
                      </Button>
                    </div>
                  </div>

                  {trackedParcel ? (
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                      <Card className="space-y-8">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="text-2xl font-bold text-gray-900">{trackedParcel.trackingNumber}</h3>
                            <p className="text-indigo-600 font-semibold capitalize">{trackedParcel.status.replace('-', ' ')}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-500">Estimated Delivery</p>
                            <p className="font-bold text-gray-900">Today, 4:00 PM</p>
                          </div>
                        </div>

                        <div className="relative">
                          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-100" />
                          <div className="space-y-8 relative">
                            {trackedParcel.history.map((step, i) => (
                              <div key={i} className="flex gap-6">
                                <div className={cn(
                                  "w-8 h-8 rounded-full flex items-center justify-center z-10",
                                  i === 0 ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "bg-white border-2 border-gray-200 text-gray-400"
                                )}>
                                  {i === 0 ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                                </div>
                                <div>
                                  <p className="font-bold text-gray-900 capitalize">{step.status.replace('-', ' ')}</p>
                                  <p className="text-sm text-gray-500">{step.note}</p>
                                  <p className="text-xs text-gray-400 mt-1">{new Date(step.time).toLocaleString()}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 pt-6 border-t border-gray-100">
                          <div>
                            <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">From</p>
                            <p className="text-sm font-medium text-gray-900">{trackedParcel.pickupAddress}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">To</p>
                            <p className="text-sm font-medium text-gray-900">{trackedParcel.deliveryAddress}</p>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  ) : trackingNumber && (
                    <div className="text-center py-12">
                      <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                      <p className="text-gray-500">No parcel found with that tracking number.</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'lockers' && (
                <div className="space-y-8">
                  <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h1 className="text-3xl font-bold text-gray-900">Smart Lockers</h1>
                      <p className="text-gray-500">Secure self-service pickup points across Mvita, Mombasa.</p>
                    </div>
                    <div className="flex gap-2">
                      {profile?.role === 'admin' && lockers.length === 0 && (
                        <Button variant="outline" onClick={seedLockers}>
                          Seed Initial Data
                        </Button>
                      )}
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input 
                          type="text"
                          placeholder="Search locations..."
                          value={lockerSearch}
                          onChange={(e) => setLockerSearch(e.target.value)}
                          className="pl-10 pr-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none text-sm w-64"
                        />
                      </div>
                    </div>
                  </header>

                  <div className="flex flex-wrap gap-6 p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <span className="text-xs font-semibold text-gray-600">Available</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-gray-400" />
                      <span className="text-xs font-semibold text-gray-600">Occupied</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500" />
                      <span className="text-xs font-semibold text-gray-600">Maintenance</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {lockers
                      .filter(l => l.locationName.toLowerCase().includes(lockerSearch.toLowerCase()) || l.address.toLowerCase().includes(lockerSearch.toLowerCase()))
                      .map(locker => (
                      <Card key={locker.id} className="space-y-4 hover:border-indigo-200 transition-all group">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-100 rounded-lg group-hover:bg-indigo-100 transition-colors">
                              <Lock className="w-5 h-5 text-purple-600 group-hover:text-indigo-600" />
                            </div>
                            <h3 className="font-bold text-gray-900">{locker.locationName}</h3>
                          </div>
                          <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">
                            {locker.compartments.filter(c => c.status === 'available').length} Free
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 flex items-start gap-2">
                          <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                          {locker.address}
                        </p>
                        
                        <div className="pt-2">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Compartments</p>
                          <div className="grid grid-cols-4 gap-2">
                            {locker.compartments.map((comp, i) => (
                              <div 
                                key={i}
                                title={`Compartment ${comp.id}: ${comp.status}`}
                                className={cn(
                                  "aspect-square rounded-lg border flex flex-col items-center justify-center transition-all hover:scale-110 cursor-help p-1",
                                  comp.status === 'available' ? "bg-green-50 border-green-200 text-green-600" :
                                  comp.status === 'occupied' ? "bg-gray-50 border-gray-200 text-gray-400" :
                                  "bg-red-50 border-red-200 text-red-600"
                                )}
                              >
                                {comp.status === 'available' ? (
                                  <CheckCircle2 className="w-4 h-4" />
                                ) : comp.status === 'occupied' ? (
                                  <Lock className="w-4 h-4" />
                                ) : (
                                  <AlertCircle className="w-4 h-4" />
                                )}
                                <span className="text-[8px] font-bold mt-0.5">{comp.id}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        
                        <Button 
                          variant="outline" 
                          className="w-full mt-2"
                          onClick={() => setSelectedLocker(locker)}
                        >
                          Reserve Compartment
                        </Button>
                      </Card>
                    ))}
                    
                    {lockers.length === 0 && (
                      <div className="col-span-full text-center py-20 bg-white rounded-3xl border border-dashed border-gray-200">
                        <Lock className="w-16 h-16 text-gray-200 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-gray-900">No Lockers Found</h3>
                        <p className="text-gray-500">We are currently expanding our locker network in Mombasa.</p>
                      </div>
                    )}
                  </div>

                  {/* Reservation & Confirmation Modals */}
                  <AnimatePresence>
                    {selectedLocker && !reservationConfirmation && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 space-y-6"
                        >
                          <div className="flex justify-between items-center">
                            <h2 className="text-2xl font-bold text-gray-900">Reserve Locker</h2>
                            <Button variant="ghost" onClick={() => setSelectedLocker(null)} className="p-1 rounded-full">
                              <LogOut className="w-5 h-5 rotate-180" />
                            </Button>
                          </div>

                          <div className="space-y-4">
                            <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                              <p className="text-xs text-indigo-400 font-bold uppercase">Location</p>
                              <p className="font-bold text-indigo-900">{selectedLocker.locationName}</p>
                              <p className="text-sm text-indigo-700">{selectedLocker.address}</p>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                              <Select 
                                label="Compartment Size"
                                options={[
                                  { value: 'small', label: 'Small (30x30x30 cm)' },
                                  { value: 'medium', label: 'Medium (50x50x50 cm)' },
                                  { value: 'large', label: 'Large (80x80x80 cm)' },
                                ]}
                              />
                              <Select 
                                label="Duration"
                                options={[
                                  { value: '24', label: '24 Hours' },
                                  { value: '48', label: '48 Hours' },
                                  { value: '72', label: '72 Hours' },
                                ]}
                              />
                            </div>

                            <Select 
                              label="Payment Method"
                              options={[
                                { value: 'mpesa', label: 'M-Pesa' },
                                { value: 'cash', label: 'Cash' },
                                { value: 'bank', label: 'Bank Transfer' },
                                { value: 'paypal', label: 'PayPal' },
                              ]}
                            />

                            <div className="p-4 bg-yellow-50 rounded-2xl border border-yellow-100 flex gap-3">
                              <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0" />
                              <p className="text-xs text-yellow-700">
                                Reservations are held for 2 hours. A pickup code will be sent to your phone once the parcel is deposited.
                              </p>
                            </div>
                          </div>

                          <Button className="w-full py-4" onClick={() => {
                            const code = `PH-${Math.floor(Math.random()*1000000)}`;
                            const availableComp = selectedLocker.compartments.find(c => c.status === 'available');
                            setReservationConfirmation({
                              locker: selectedLocker,
                              code: code,
                              compartmentId: availableComp?.id || 'A1'
                            });
                          }}>
                            Confirm Reservation
                          </Button>
                        </motion.div>
                      </div>
                    )}

                    {reservationConfirmation && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 space-y-6 text-center"
                        >
                          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2">
                            <CheckCircle2 className="w-8 h-8 text-green-600" />
                          </div>
                          
                          <div>
                            <h2 className="text-2xl font-bold text-gray-900">Reservation Confirmed!</h2>
                            <p className="text-gray-500 text-sm">Your locker compartment is ready for drop-off.</p>
                          </div>

                          <div className="p-6 bg-gray-50 rounded-2xl border border-gray-100 space-y-4">
                            <div className="flex flex-col items-center gap-4">
                              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                                <QRCodeSVG 
                                  value={`LOCKER:${reservationConfirmation.locker.id}|COMP:${reservationConfirmation.compartmentId}|CODE:${reservationConfirmation.code}`} 
                                  size={160}
                                />
                              </div>
                              <div className="text-center">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Access Code</p>
                                <p className="text-2xl font-mono font-bold text-indigo-600 tracking-tighter">{reservationConfirmation.code}</p>
                              </div>
                            </div>

                            <div className="pt-4 border-t border-gray-200 text-left space-y-3">
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Locker Address</p>
                                <p className="text-sm font-semibold text-gray-700">{reservationConfirmation.locker.address}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Compartment</p>
                                <p className="text-sm font-semibold text-gray-700">Section {reservationConfirmation.compartmentId}</p>
                              </div>
                            </div>
                          </div>

                          <div className="bg-blue-50 p-4 rounded-xl text-left flex gap-3">
                            <Clock className="w-5 h-5 text-blue-600 shrink-0" />
                            <div>
                              <p className="text-xs font-bold text-blue-900">Pickup Instructions</p>
                              <p className="text-[11px] text-blue-700 leading-relaxed">
                                1. Scan the QR code at the locker terminal.<br/>
                                2. Or enter the Access Code manually.<br/>
                                3. The compartment door will open automatically.
                              </p>
                            </div>
                          </div>

                          <Button className="w-full py-4" onClick={() => {
                            setReservationConfirmation(null);
                            setSelectedLocker(null);
                          }}>
                            Done
                          </Button>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {activeTab === 'ai-assistant' && (
                <div className="max-w-3xl mx-auto space-y-8">
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">Route Assistant</h1>
                    <p className="text-gray-500">Ask Gemini for the best routes, nearby hubs, or delivery advice in Mombasa.</p>
                  </div>

                  <Card className="space-y-4">
                    <div className="flex gap-2">
                      <Input 
                        placeholder="e.g. What's the fastest route from TUM to Mvita Market right now?" 
                        className="flex-1"
                        onKeyDown={(e) => e.key === 'Enter' && askGemini((e.target as HTMLInputElement).value)}
                      />
                      <Button onClick={() => {
                        const input = document.querySelector('input[placeholder*="fastest route"]') as HTMLInputElement;
                        askGemini(input.value);
                      }} disabled={isAiLoading}>
                        {isAiLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Navigation className="w-5 h-5" />}
                        Ask
                      </Button>
                    </div>

                    {aiResponse && (
                      <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }}
                        className="p-6 bg-indigo-50 rounded-2xl border border-indigo-100 prose prose-indigo max-w-none"
                      >
                        <Markdown>{aiResponse}</Markdown>
                      </motion.div>
                    )}
                  </Card>
                </div>
              )}

              {activeTab === 'image-gen' && (
                <div className="max-w-3xl mx-auto space-y-8">
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">Label Designer</h1>
                    <p className="text-gray-500">Generate custom parcel labels or promotional graphics using AI.</p>
                  </div>

                  <Card className="space-y-6">
                    <div className="space-y-4">
                      <Input 
                        label="Design Prompt"
                        placeholder="e.g. A minimalist delivery label for a high-end electronics store in Mombasa" 
                        value={imagePrompt}
                        onChange={(e) => setImagePrompt(e.target.value)}
                      />
                      <Button onClick={generateImage} className="w-full" disabled={isImageLoading || !imagePrompt}>
                        {isImageLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
                        Generate Design
                      </Button>
                    </div>

                    {generatedImage && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }} 
                        animate={{ opacity: 1, scale: 1 }}
                        className="space-y-4"
                      >
                        <div className="rounded-2xl overflow-hidden border-4 border-white shadow-xl">
                          <img src={generatedImage} alt="AI Generated Label" className="w-full h-auto" referrerPolicy="no-referrer" />
                        </div>
                        <Button variant="outline" className="w-full" onClick={() => {
                          const link = document.createElement('a');
                          link.href = generatedImage;
                          link.download = 'parcel-label.png';
                          link.click();
                        }}>
                          Download Design
                        </Button>
                      </motion.div>
                    )}
                  </Card>
                </div>
              )}

              {activeTab === 'courier' && profile?.role === 'courier' && (
                <div className="space-y-8">
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">Courier Portal</h1>
                    <p className="text-gray-500">Manage your assigned deliveries and update statuses.</p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-4">
                      <h2 className="text-xl font-bold text-gray-900">Assigned Tasks</h2>
                      {parcels.filter(p => p.status !== 'delivered').map(parcel => (
                        <Card key={parcel.id} className="space-y-4">
                          <div className="flex justify-between items-start">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-indigo-100 rounded-lg">
                                <Package className="w-5 h-5 text-indigo-600" />
                              </div>
                              <div>
                                <p className="font-bold text-gray-900">{parcel.trackingNumber}</p>
                                <p className="text-sm text-gray-500">To: {parcel.recipientName}</p>
                              </div>
                            </div>
                            <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold uppercase tracking-wider">
                              {parcel.status}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4 border-y border-gray-50">
                            <div className="flex items-start gap-2">
                              <MapPin className="w-4 h-4 text-gray-400 mt-1" />
                              <div>
                                <p className="text-xs text-gray-400 font-bold uppercase">Pickup</p>
                                <p className="text-sm text-gray-700">{parcel.pickupAddress}</p>
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <Navigation className="w-4 h-4 text-gray-400 mt-1" />
                              <div>
                                <p className="text-xs text-gray-400 font-bold uppercase">Delivery</p>
                                <p className="text-sm text-gray-700">{parcel.deliveryAddress}</p>
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <Button 
                              className="flex-1" 
                              onClick={() => updateParcelStatus(parcel.id, 'picked-up')}
                              disabled={parcel.status !== 'pending'}
                            >
                              Mark Picked Up
                            </Button>
                            <Button 
                              className="flex-1" 
                              variant="secondary"
                              onClick={() => updateParcelStatus(parcel.id, 'delivered')}
                              disabled={parcel.status === 'pending'}
                            >
                              Mark Delivered
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>

                    <div className="space-y-6">
                      <Card className="bg-indigo-600 text-white">
                        <h3 className="font-bold text-lg mb-4">Daily Stats</h3>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <span className="text-indigo-100 text-sm">Completed</span>
                            <span className="text-2xl font-bold">{parcels.filter(p => p.status === 'delivered').length}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-indigo-100 text-sm">Pending</span>
                            <span className="text-2xl font-bold">{parcels.filter(p => p.status !== 'delivered').length}</span>
                          </div>
                        </div>
                      </Card>

                      <Card>
                        <h3 className="font-bold text-gray-900 mb-4">Quick Actions</h3>
                        <div className="space-y-2">
                          <Button variant="outline" className="w-full justify-start">
                            <Phone className="w-4 h-4" />
                            Call Support
                          </Button>
                          <Button variant="outline" className="w-full justify-start">
                            <AlertCircle className="w-4 h-4" />
                            Report Delay
                          </Button>
                        </div>
                      </Card>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'admin' && profile?.role === 'admin' && (
                <div className="space-y-8">
                  <header className="flex justify-between items-center">
                    <div>
                      <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
                      <p className="text-gray-500">System-wide overview and management.</p>
                    </div>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="p-4 text-center">
                      <p className="text-xs text-gray-400 font-bold uppercase">Total Parcels</p>
                      <p className="text-2xl font-bold text-gray-900">{parcels.length}</p>
                    </Card>
                    <Card className="p-4 text-center">
                      <p className="text-xs text-gray-400 font-bold uppercase">Active Couriers</p>
                      <p className="text-2xl font-bold text-gray-900">12</p>
                    </Card>
                    <Card className="p-4 text-center">
                      <p className="text-xs text-gray-400 font-bold uppercase">Revenue (KES)</p>
                      <p className="text-2xl font-bold text-gray-900">45,200</p>
                    </Card>
                    <Card className="p-4 text-center">
                      <p className="text-xs text-gray-400 font-bold uppercase">Issues</p>
                      <p className="text-2xl font-bold text-red-600">{parcels.filter(p => p.status === 'issue').length}</p>
                    </Card>
                  </div>

                  <Card className="overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                      <h3 className="font-bold text-gray-900">User Management</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-gray-50 text-xs text-gray-400 font-bold uppercase tracking-wider">
                          <tr>
                            <th className="px-6 py-4">Name</th>
                            <th className="px-6 py-4">Email</th>
                            <th className="px-6 py-4">Role</th>
                            <th className="px-6 py-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {usersList.map(u => (
                            <tr key={u.uid} className="hover:bg-gray-50 transition-colors">
                              <td className="px-6 py-4 font-bold text-gray-900">{u.name}</td>
                              <td className="px-6 py-4 text-sm text-gray-500">{u.email}</td>
                              <td className="px-6 py-4">
                                <span className={cn(
                                  "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                  u.role === 'admin' ? "bg-purple-100 text-purple-700" : 
                                  u.role === 'courier' ? "bg-blue-100 text-blue-700" : 
                                  "bg-gray-100 text-gray-700"
                                )}>
                                  {u.role}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex gap-2">
                                  <select 
                                    value={u.role}
                                    onChange={(e) => updateUserRole(u.uid, e.target.value as any)}
                                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none"
                                  >
                                    <option value="client">Client</option>
                                    <option value="courier">Courier</option>
                                    <option value="admin">Admin</option>
                                  </select>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  <Card className="overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                      <h3 className="font-bold text-gray-900">All Shipments</h3>
                      <div className="flex gap-2">
                        <Button variant="ghost" className="text-xs">Export CSV</Button>
                        <Button variant="ghost" className="text-xs">Filter</Button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-gray-50 text-xs text-gray-400 font-bold uppercase tracking-wider">
                          <tr>
                            <th className="px-6 py-4">Tracking #</th>
                            <th className="px-6 py-4">Sender</th>
                            <th className="px-6 py-4">Recipient</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {parcels.map(parcel => (
                            <tr key={parcel.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-6 py-4 font-bold text-gray-900">{parcel.trackingNumber}</td>
                              <td className="px-6 py-4 text-sm text-gray-500">{parcel.senderUid.slice(0, 8)}...</td>
                              <td className="px-6 py-4 text-sm text-gray-900 font-medium">{parcel.recipientName}</td>
                              <td className="px-6 py-4">
                                <span className={cn(
                                  "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                  parcel.status === 'delivered' ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                                )}>
                                  {parcel.status}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-500">
                                {new Date(parcel.createdAt?.seconds * 1000).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Mobile Bottom Nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex items-center justify-around px-2 py-3 z-40 safe-area-bottom">
          {NAV_ITEMS
          .filter(item => ['dashboard', 'history', 'booking', 'tracking'].includes(item.id))
          .map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-1 rounded-lg transition-all",
                activeTab === item.id ? "text-indigo-600" : "text-gray-400"
              )}
            >
              <item.icon className="w-6 h-6" />
              <span className="text-[10px] font-bold">{item.label.split(' ')[0]}</span>
            </button>
          ))}
        </nav>
      </div>
    </ErrorBoundary>
  );
}
