import { createContext, useContext, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

const CompanyContext = createContext(null);

export function CompanyProvider({ children }) {
  const [company, setCompany] = useState(null);
  const [loadingCompany, setLoadingCompany] = useState(true);

  useEffect(() => {
    loadCompany();
  }, []);

  const loadCompany = async () => {
    try {
      const user = await base44.auth.me();
      const allCompanies = await base44.entities.Company.list();

      if (user.role === 'admin') {
        // Admin: find the company they own by their email
        const ownCompany = allCompanies.find(c => c.owner_email === user.email);
        if (ownCompany) {
          if (user.company_id !== ownCompany.id) {
            await base44.auth.updateMe({ company_id: ownCompany.id });
          }
          setCompany(ownCompany);
        }
        // If no company found for admin, they'll see Onboarding (company is null)
      } else {
        // Worker: only use saved company_id or match by who invited them
        let foundCompany = null;

        // 1. Use saved company_id if valid
        if (user.company_id) {
          foundCompany = allCompanies.find(c => c.id === user.company_id);
        }

        // 2. Match by inviter email (who created/invited them)
        if (!foundCompany && user.created_by) {
          foundCompany = allCompanies.find(c => c.owner_email === user.created_by);
        }

        // 3. Fallback: if only one company exists, assign the worker to it
        if (!foundCompany && allCompanies.length === 1) {
          foundCompany = allCompanies[0];
        }

        if (foundCompany) {
          if (user.company_id !== foundCompany.id) {
            await base44.auth.updateMe({ company_id: foundCompany.id });
          }
          setCompany(foundCompany);
        }
        // If no company found for worker, company stays null — they'll see a "contact admin" screen
      }
    } catch (e) {
      console.error('Failed to load company:', e);
    }
    setLoadingCompany(false);
  };

  const refreshCompany = () => loadCompany();

  return (
    <CompanyContext.Provider value={{ company, loadingCompany, refreshCompany, setCompany }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}