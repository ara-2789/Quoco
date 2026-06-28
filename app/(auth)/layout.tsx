export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="text-3xl font-bold text-gray-900 tracking-tight">Quoco</span>
          <p className="text-sm text-gray-500 mt-1">Construction Management</p>
        </div>
        {children}
      </div>
    </div>
  )
}
