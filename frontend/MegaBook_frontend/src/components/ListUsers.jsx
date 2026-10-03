import React, { useState, useEffect } from 'react'

const ListUsers = () => {

    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        async function fetchUsers() {
            try {
                const list = await fetch('http://localhost:8000/api/list');
                const usersList = await list.json();
                setUsers(usersList);
            } catch (error) {
                setError(error);
            } finally {
                setLoading(false);
            }
        }

        fetchUsers();

    }, []);

    return (
        <div>
            {loading && <p>Loading...</p>}
            {error && <p>Error: {error.message}</p>}
            <ul>
                {users.map(user => (
                    <li key={user.id}>{user.email}</li>
                ))}
            </ul>
        </div>
        // <><input name="username" value={formData.username}
        //     onChange={(e) => setFormData({ ...formData, username: e.target.value })} />
        //     <input name="email" value={formData.email}
        //         onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
        //     <input name="password" value={formData.password}
        //         onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
        // </>
    )
}

export default ListUsers


